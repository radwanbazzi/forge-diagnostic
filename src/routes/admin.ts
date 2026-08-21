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
import { and, count, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm';
import type { HonoEnv } from '../types';
import { getDb } from '../db/client';
import { diagnostics } from '../db/schema';
import { requireAdmin } from '../lib/access';
import { buildFounderWhatsAppMessage } from '../lib/whatsapp';
import type { ResultPayload } from '../lib/resultCopy';

const admin = new Hono<HonoEnv>();

// Gate everything under /api/admin.
admin.use('*', requireAdmin());

const LEAD_STATUSES = ['HOT', 'WARM', 'COLD'] as const;
const PROGRAMS = ['$80 SAT Essentials', '$130 SAT Accelerator'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
		conds.push(like(diagnostics.first_name, `%${q.q.trim()}%`));
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

// ── still stubbed (contract-first), but behind auth so unauth → 401 ──
admin.patch('/leads/:id', (c) => c.json({ error: 'not_implemented', endpoint: 'PATCH /api/admin/leads/:id', milestone: 'B5' }, 501));
admin.get('/analytics', (c) => c.json({ error: 'not_implemented', endpoint: 'GET /api/admin/analytics', milestone: 'B6' }, 501));

export default admin;
