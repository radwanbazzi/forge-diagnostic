/**
 * Analytics event ingest (public). Mounted at /api/event. (B6)
 *
 * ── POST /api/event ─────────────────────────────────────────
 * Fire-and-forget beacon. No auth. Body: { session_id, type, question_index?, meta? }.
 *   - 202 on accept.
 *   - Bad JSON / bad body → 400 (a malformed beacon, not a server error).
 *   - Flood (per IP + session) → 429 (dropped) — US-7 F7.1.
 *   - It must NEVER return 500: a failed DB insert is swallowed (logged) and still 202,
 *     so a student's flow is never blocked by analytics.
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { getDb } from '../db/client';
import { events as eventsTable } from '../db/schema';
import { eventSchema } from '../lib/validation';
import { checkRateLimit } from '../lib/rateLimit';

const events = new Hono<HonoEnv>();

// A real student fires ~26 events over several minutes; 60 per minute per session+IP is
// generous headroom while still dropping an obvious flood.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

events.post('/', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'invalid_json' }, 400);
	}

	const parsed = eventSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: 'invalid_event' }, 400);
	const ev = parsed.data;

	// F7.1: drop a flood with 429 (per IP + session), never crash.
	const ip = c.req.header('cf-connecting-ip') || 'local';
	if (!checkRateLimit(`${ip}:${ev.session_id}`, Date.now(), RATE_LIMIT, RATE_WINDOW_MS)) {
		return c.json({ error: 'rate_limited' }, 429);
	}

	// Fire-and-forget: swallow any write error so the beacon never blocks the student.
	try {
		await getDb(c.env)
			.insert(eventsTable)
			.values({
				id: crypto.randomUUID(),
				session_id: ev.session_id,
				type: ev.type,
				question_index: ev.question_index ?? null,
				meta: ev.meta ? JSON.stringify(ev.meta) : null,
			});
	} catch (err) {
		console.error('event insert failed (dropped, not fatal)', err); // never 500
	}

	return c.body(null, 202);
});

export default events;
