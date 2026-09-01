/**
 * Diagnostic routes (public). Mounted at /api/diagnostic.
 *
 * ── POST /api/diagnostic/submit ─────────────────────────────  (B3)
 * Validate → score (lib/scoring) → build result_payload (lib/resultCopy) → persist
 * ONE diagnostics row (answers + computed snapshot + payload) → return { id, result_payload }.
 *
 * Required failure behavior (BACKEND_SPEC §1, US-1):
 *   F1.1 missing/invalid field      → 400 (field-level issues); nothing persisted
 *   F1.2 consent !== true            → 400 "consent required"; nothing persisted
 *   F1.3 malformed JSON              → 400; nothing persisted
 *   F1.4 unknown answer option       → 400 (zod enum); nothing persisted
 *   F1.5 D1 write fails              → 500 generic; logged; result + lead are atomic (one row)
 *   F1.6 duplicate session_id        → dedupe via upsert on the unique session_id (no duplicate lead)
 *   F1.7 extra/unknown fields        → stripped by zod (not an error)
 *   F1.8 impossible scoring state    → fail closed: 500, logged, no row
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { HonoEnv } from '../types';
import { getDb } from '../db/client';
import { diagnostics } from '../db/schema';
import { submissionSchema } from '../lib/validation';
import { isValidComputed, score } from '../lib/scoring';
import { buildResultPayload } from '../lib/resultCopy';
import { checkRateLimit } from '../lib/rateLimit';

const diagnostic = new Hono<HonoEnv>();

// Public-POST rate limit: 30 submissions per minute per IP. A real student submits once;
// this is generous while stopping abuse. Best-effort per-isolate (see rateLimit.ts).
const SUBMIT_RATE_LIMIT = 30;
const SUBMIT_RATE_WINDOW_MS = 60_000;

diagnostic.post('/submit', async (c) => {
	// Hardening: drop a per-IP flood before doing any work (429, never 500).
	const ip = c.req.header('cf-connecting-ip') || 'local';
	if (!checkRateLimit(`submit:${ip}`, Date.now(), SUBMIT_RATE_LIMIT, SUBMIT_RATE_WINDOW_MS)) {
		return c.json({ error: 'rate_limited' }, 429);
	}

	// F1.3 — malformed JSON.
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
	}

	// F1.1 / F1.3 / F1.4 — validate. Unknown keys are stripped (F1.7).
	const parsed = submissionSchema.safeParse(body);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
		return c.json({ error: 'validation_error', issues }, 400);
	}
	const { session_id, source, completion_time_sec, skills_timings, answers, contact } = parsed.data;

	// F1.2 — consent must be exactly true.
	if (contact.consent !== true) {
		return c.json({ error: 'consent_required', message: 'consent required' }, 400);
	}

	// F-M-Timer: derive the stored aggregates from the per-question timing (when the client sent it).
	// These feed the MEASURED "Time-Pressured" archetype (§7.5) and are snapshotted on the row.
	const skillsTimeTotalSec = skills_timings
		? Object.values(skills_timings).reduce((sum, t) => sum + t.sec, 0)
		: null;
	const skillsTimedOutCount = skills_timings
		? Object.values(skills_timings).filter((t) => t.timed_out).length
		: null;

	// Score (pure, B2). Contact presence feeds the lead score (§7.9); timing feeds the archetype (§7.5).
	const computed = score({
		answers,
		contact: { whatsapp: contact.whatsapp, school: contact.school ?? null },
		timing: skills_timings,
	});

	// F1.8 — fail closed if scoring produced an impossible state.
	if (!isValidComputed(computed)) {
		console.error('diagnostic submit: impossible computed state', { session_id });
		return c.json({ error: 'scoring_error' }, 500);
	}

	// Snapshot the exact rendered result (§8). Env values drive the CTA (US-2/F2.1 fallback).
	const result_payload = buildResultPayload(computed, answers, contact.first_name, {
		whatsappNumber: c.env.WHATSAPP_NUMBER,
		whishLink: c.env.WHISH_LINK,
	});

	// One row: identity + answers + contact + computed snapshot + payload.
	const writable = {
		session_id,
		source: source ?? null,
		completion_time_sec: completion_time_sec ?? null,
		skills_time_total_sec: skillsTimeTotalSec,
		skills_timed_out_count: skillsTimedOutCount,
		skills_timings: skills_timings ? JSON.stringify(skills_timings) : null,
		...answers,
		first_name: contact.first_name,
		whatsapp: contact.whatsapp,
		school: contact.school ?? null,
		respondent_type: (contact.respondent_type === 'Parent' ? 'parent' : 'student') as 'student' | 'parent',
		consent: 1,
		...computed,
		result_payload: JSON.stringify(result_payload),
	} satisfies Omit<typeof diagnostics.$inferInsert, 'id'>;

	const id = crypto.randomUUID();

	try {
		const db = getDb(c.env);
		// F1.6 — dedupe on the unique session_id: a re-submit updates the same lead row.
		// F1.5 — a single upsert statement is atomic: it either fully writes or nothing does.
		const returned = await db
			.insert(diagnostics)
			.values({ id, ...writable })
			.onConflictDoUpdate({ target: diagnostics.session_id, set: writable })
			.returning({ id: diagnostics.id });

		let savedId = returned[0]?.id;
		if (!savedId) {
			const existing = await db.select({ id: diagnostics.id }).from(diagnostics).where(eq(diagnostics.session_id, session_id)).limit(1);
			savedId = existing[0]?.id ?? id;
		}

		return c.json({ id: savedId, result_payload }, 200);
	} catch (err) {
		// F1.5 — never return a result the lead could not be saved against.
		console.error('diagnostic submit: D1 write failed', err);
		return c.json({ error: 'server_error' }, 500);
	}
});

export default diagnostic;
