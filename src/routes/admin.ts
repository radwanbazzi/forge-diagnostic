/**
 * Admin routes (founder only). Mounted at /api/admin. Every route requires an
 * authenticated founder (Cloudflare Access in production; a gated dev bypass locally —
 * see src/lib/access.ts). Handlers stay lean: the list uses one COUNT + one paged
 * SELECT (no N+1), the detail is a single indexed lookup.
 *
 * ── GET /api/admin/leads ────────────────────────────────────  (B4)
 * Query: status?, program? ('80'|'130' or the full name), from?, to? (unix-ms or ISO),
 *        q? (name search), limit? (1–200, default 50), offset? (default 0).
 * 200 { leads: [...summary, newest-first], total }.
 * Failures: 401 (F3.1) · empty/no-match → 200 [] (F3.2/F3.3) · invalid filter 400 (F3.4) · 500 (F3.5)
 *
 * ── GET /api/admin/leads/:id ────────────────────────────────  (B4)
 * 200 full row + parsed result_payload + assembled whatsapp_message (PRD §10).
 * Failures: 404 (F4.1) · 400 malformed id (F4.2) · 401 (F4.3)
 *
 * ── PATCH /api/admin/leads/:id ─ (B5) · GET /api/admin/analytics ─ (B6): stubs, behind auth.
 */
import { Hono } from 'hono';
import { and, count, countDistinct, desc, eq, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import type { HonoEnv } from '../types';
import { getDb } from '../db/client';
import { diagnostics, events as eventsTable } from '../db/schema';
import { requireAdmin } from '../lib/access';
import { buildFounderWhatsAppMessage } from '../lib/whatsapp';
import { leadUpdateSchema } from '../lib/validation';
import type { ResultPayload } from '../lib/resultCopy';

const admin = new Hono<HonoEnv>();

// Gate everything under /api/admin.
admin.use('*', requireAdmin());

const LEAD_STATUSES = ['HOT', 'WARM', 'COLD'] as const;
const PROGRAMS = ['$80 SAT Essentials', '$130 SAT Accelerator'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The stored `whatsapp` is free text — students type "+961 70 123 456", "03-123-456",
 * "70123456". Strip the punctuation in SQL so a digits-only query matches any format.
 * Not indexable, so this is a scan; acceptable at this scale and only ever run when the
 * search query actually contains digits.
 */
const WHATSAPP_DIGITS = sql`replace(replace(replace(replace(replace(replace(replace(replace(replace(${diagnostics.whatsapp}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), '/', ''), ',', ''), char(160), '')`;

/**
 * `%` and `_` are LIKE wildcards. Without escaping, searching "%" matches every lead and
 * "a_c" matches "abc" — silently wrong results in the founder's search box. Escape them
 * (and the escape character itself) and pair with an explicit ESCAPE clause below.
 */
function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Did this lead tap the WhatsApp CTA? A correlated EXISTS keeps the list at one COUNT +
 * one paged SELECT (no N+1); idx_events_session_type makes it a point lookup.
 *
 * ⚠️ Both sides of the correlation are written as literal SQL on purpose. Interpolating
 * the Drizzle columns (`${eventsTable.session_id} = ${diagnostics.session_id}`) emits them
 * UNQUALIFIED, so inside the subquery both resolve to the inner table and the predicate
 * degrades to `session_id = session_id` — always true, marking every lead as engaged.
 * Keep the explicit `e.` / `diagnostics.` prefixes.
 */
const WHATSAPP_CLICKED = sql<number>`EXISTS (SELECT 1 FROM events e WHERE e.session_id = diagnostics.session_id AND e.type = 'whatsapp_clicked')`;

/** Lean list projection (PRD §9 columns + a few), never the heavy result_payload/answers. */
const LIST_COLUMNS = {
	id: diagnostics.id,
	created_at: diagnostics.created_at,
	first_name: diagnostics.first_name,
	whatsapp: diagnostics.whatsapp,
	school: diagnostics.school,
	archetype: diagnostics.archetype,
	overall_band: diagnostics.overall_band,
	gap: diagnostics.gap,
	lead_score: diagnostics.lead_score,
	lead_status: diagnostics.lead_status,
	recommended_program: diagnostics.recommended_program,
	result_sent: diagnostics.result_sent,
	followup_status: diagnostics.followup_status,
	outcome: diagnostics.outcome,
	whatsapp_clicked: WHATSAPP_CLICKED,
};

/** Parse a from/to date filter: accepts unix-ms (digits) or an ISO date/datetime string. */
function parseTimestamp(v: string): number | null {
	if (/^\d+$/.test(v)) return Number(v);
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : t;
}

admin.get('/leads', async (c) => {
	const q = c.req.query();
	const conds: SQL[] = [];

	if (q.status !== undefined) {
		const s = q.status.toUpperCase() as (typeof LEAD_STATUSES)[number];
		if (!LEAD_STATUSES.includes(s)) return c.json({ error: 'invalid_filter', field: 'status', allowed: LEAD_STATUSES }, 400);
		conds.push(eq(diagnostics.lead_status, s));
	}

	if (q.program !== undefined) {
		const p = q.program === '80' ? PROGRAMS[0] : q.program === '130' ? PROGRAMS[1] : (q.program as (typeof PROGRAMS)[number]);
		if (!PROGRAMS.includes(p)) return c.json({ error: 'invalid_filter', field: 'program', allowed: [...PROGRAMS, '80', '130'] }, 400);
		conds.push(eq(diagnostics.recommended_program, p));
	}

	if (q.result_sent !== undefined) {
		if (q.result_sent !== '0' && q.result_sent !== '1') {
			return c.json({ error: 'invalid_filter', field: 'result_sent', allowed: ['0', '1'] }, 400);
		}
		conds.push(eq(diagnostics.result_sent, q.result_sent === '1' ? 1 : 0));
	}

	if (q.engaged !== undefined) {
		if (q.engaged !== '0' && q.engaged !== '1') {
			return c.json({ error: 'invalid_filter', field: 'engaged', allowed: ['0', '1'] }, 400);
		}
		conds.push(sql`${WHATSAPP_CLICKED} = ${q.engaged === '1' ? 1 : 0}`);
	}

	if (q.from !== undefined) {
		const t = parseTimestamp(q.from);
		if (t === null) return c.json({ error: 'invalid_filter', field: 'from', message: 'expected unix-ms or an ISO date' }, 400);
		conds.push(gte(diagnostics.created_at, t));
	}
	if (q.to !== undefined) {
		const t = parseTimestamp(q.to);
		if (t === null) return c.json({ error: 'invalid_filter', field: 'to', message: 'expected unix-ms or an ISO date' }, 400);
		conds.push(lte(diagnostics.created_at, t));
	}

	if (q.q !== undefined && q.q.trim() !== '') {
		const term = q.q.trim();
		const nameMatch = sql`${diagnostics.first_name} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`;
		// Only search numbers when the query really looks like one: 1–2 digits would
		// match almost every lead and make the search useless. `digits` is \D-stripped,
		// so it can never carry a LIKE wildcard and needs no escaping.
		const digits = term.replace(/\D/g, '');
		if (digits.length >= 3) {
			conds.push(or(nameMatch, sql`${WHATSAPP_DIGITS} LIKE ${`%${digits}%`}`) as SQL);
		} else {
			conds.push(nameMatch);
		}
	}

	let limit = 50;
	let offset = 0;
	if (q.limit !== undefined) {
		const n = Number(q.limit);
		if (!Number.isInteger(n) || n < 1 || n > 200) return c.json({ error: 'invalid_filter', field: 'limit', message: 'expected 1..200' }, 400);
		limit = n;
	}
	if (q.offset !== undefined) {
		const n = Number(q.offset);
		if (!Number.isInteger(n) || n < 0) return c.json({ error: 'invalid_filter', field: 'offset', message: 'expected >= 0' }, 400);
		offset = n;
	}

	const where = conds.length ? and(...conds) : undefined;

	try {
		const db = getDb(c.env);
		const totalRows = await db.select({ n: count() }).from(diagnostics).where(where);
		const total = totalRows[0]?.n ?? 0;
		const leads = await db.select(LIST_COLUMNS).from(diagnostics).where(where).orderBy(desc(diagnostics.created_at)).limit(limit).offset(offset);
		return c.json({ leads, total });
	} catch (err) {
		console.error('admin: list leads failed', err); // F3.5
		return c.json({ error: 'server_error' }, 500);
	}
});

admin.get('/leads/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400); // F4.2

	try {
		const db = getDb(c.env);
		const rows = await db.select().from(diagnostics).where(eq(diagnostics.id, id)).limit(1);
		const lead = rows[0];
		if (!lead) return c.json({ error: 'not_found' }, 404); // F4.1

		let payload: ResultPayload | null = null;
		try {
			payload = JSON.parse(lead.result_payload) as ResultPayload;
		} catch {
			payload = null; // corrupt payload → still return the lead; message falls back safely
		}
		const whatsapp_message = buildFounderWhatsAppMessage(lead, payload);
		const { result_payload: _raw, ...rest } = lead;
		return c.json({ ...rest, result_payload: payload, whatsapp_message });
	} catch (err) {
		console.error('admin: get lead failed', err);
		return c.json({ error: 'server_error' }, 500);
	}
});

// PATCH /api/admin/leads/:id — update ONLY the manual tracking fields (B5).
admin.patch('/leads/:id', async (c) => {
	const id = c.req.param('id');
	if (!UUID_RE.test(id)) return c.json({ error: 'invalid_id' }, 400); // malformed id → 400

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
	}

	// Whitelist: only result_sent/followup_status/outcome/notes. Any computed/answer/unknown
	// field → 400 (F5.1); a bad enum → 400 (F5.2); an empty body → 400. Nothing is written.
	const parsed = leadUpdateSchema.safeParse(body);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
		return c.json({ error: 'validation_error', issues }, 400);
	}
	const d = parsed.data;

	// Targeted update of just the provided manual fields (never rewrites immutable data).
	const set: Partial<typeof diagnostics.$inferInsert> = {};
	if (d.result_sent !== undefined) set.result_sent = d.result_sent ? 1 : 0;
	if (d.followup_status !== undefined) set.followup_status = d.followup_status;
	if (d.outcome !== undefined) set.outcome = d.outcome;
	if (d.notes !== undefined) set.notes = d.notes;

	try {
		const db = getDb(c.env);
		// F5.5: last-write-wins (no optimistic locking) — acceptable for a single-admin tool.
		const updated = await db.update(diagnostics).set(set).where(eq(diagnostics.id, id)).returning();
		if (updated.length === 0) return c.json({ error: 'not_found' }, 404); // F5.3

		const lead = updated[0];
		let payload: ResultPayload | null = null;
		try {
			payload = JSON.parse(lead.result_payload) as ResultPayload;
		} catch {
			payload = null;
		}
		const { result_payload: _raw, ...rest } = lead;
		return c.json({ ...rest, result_payload: payload });
	} catch (err) {
		console.error('admin: update lead failed', err);
		return c.json({ error: 'server_error' }, 500);
	}
});

// GET /api/admin/analytics — funnel metrics (B6, PRD §11). Simple COUNT/GROUP BY only (F7.2).
admin.get('/analytics', async (c) => {
	const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 10000) / 10000);

	try {
		const db = getDb(c.env);

		// Six independent read-only aggregates — none depends on another's result, so they
		// are issued together and the round trips overlap instead of adding up (B8 review).
		const [byType, funnelRows, statusRows, outcomeRows, archetypeRows, programRows] = await Promise.all([
			// Distinct sessions per event type.
			db.select({ type: eventsTable.type, sessions: countDistinct(eventsTable.session_id) }).from(eventsTable).groupBy(eventsTable.type),
			// Per-question drop-off: distinct sessions that reached each question (advance events).
			db
				.select({ question_index: eventsTable.question_index, count: countDistinct(eventsTable.session_id) })
				.from(eventsTable)
				.where(eq(eventsTable.type, 'advance'))
				.groupBy(eventsTable.question_index)
				.orderBy(eventsTable.question_index),
			// Status mix + total leads.
			db.select({ status: diagnostics.lead_status, n: count() }).from(diagnostics).groupBy(diagnostics.lead_status),
			// Enrolments (from the outcome field).
			db.select({ outcome: diagnostics.outcome, n: count() }).from(diagnostics).groupBy(diagnostics.outcome),
			// Audience mix (B8): who the diagnostic is attracting. Plain COUNT/GROUP BY (F7.2).
			db.select({ k: diagnostics.archetype, n: count() }).from(diagnostics).groupBy(diagnostics.archetype),
			db.select({ k: diagnostics.recommended_program, n: count() }).from(diagnostics).groupBy(diagnostics.recommended_program),
		]);

		const evt: Record<string, number> = {};
		for (const r of byType) evt[r.type] = r.sessions;
		const started = evt.start ?? 0;
		const completed = evt.completed ?? 0;
		const whatsapp_clicked = evt.whatsapp_clicked ?? 0;

		const funnel_by_question = funnelRows
			.filter((r) => r.question_index !== null)
			.map((r) => ({ question_index: r.question_index as number, count: r.count }));

		const status_mix = { HOT: 0, WARM: 0, COLD: 0 };
		let totalLeads = 0;
		for (const r of statusRows) {
			if (r.status === 'HOT' || r.status === 'WARM' || r.status === 'COLD') status_mix[r.status] = r.n;
			totalLeads += r.n;
		}

		let enrolled = 0;
		for (const r of outcomeRows) if (r.outcome?.startsWith('Enrolled')) enrolled += r.n;

		const archetype_mix: Record<string, number> = {};
		for (const r of archetypeRows) archetype_mix[r.k] = r.n;

		const program_mix: Record<string, number> = {};
		for (const r of programRows) program_mix[r.k] = r.n;

		return c.json({
			started,
			completed,
			completion_rate: pct(completed, started),
			funnel_by_question,
			status_mix,
			archetype_mix,
			program_mix,
			whatsapp_click_rate: pct(whatsapp_clicked, completed),
			enrollment_rate: pct(enrolled, totalLeads),
			totals: { leads: totalLeads, enrolled, whatsapp_clicked },
		});
	} catch (err) {
		console.error('admin: analytics failed', err);
		return c.json({ error: 'server_error' }, 500);
	}
});

export default admin;
