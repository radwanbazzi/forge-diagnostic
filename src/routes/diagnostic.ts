/**
 * Diagnostic routes (public). Mounted at /api/diagnostic.
 *
 * ── POST /api/diagnostic/submit ─────────────────────────────  (implement in B3)
 * Create a scored lead. No auth.
 *
 * Request body (JSON):
 * {
 *   session_id: string,              // client-generated per attempt (dedupe, US-1.6)
 *   source?: string,                 // UTM/source captured from the landing URL
 *   completion_time_sec?: number,
 *   answers: {                       // the 17 scored/among-22 fields (PRD §6 / §7)
 *     target_score, grade, test_date, sat_history,
 *     q5, q6, q7, q8, q9, q10, q11, q12,
 *     hours_per_week, timing, review_mistakes, prep_status, worried_about
 *   },
 *   contact: {
 *     first_name: string,
 *     whatsapp: string,
 *     school?: string,
 *     respondent_type: 'student' | 'parent',
 *     consent: boolean               // must be true
 *   }
 * }
 *
 * Success 200: { id: string, result_payload: {...} }   // everything the result screen renders
 *
 * Required failure behavior (BACKEND_SPEC §1, US-1):
 *   F1.1 missing/invalid required field          → 400 (field-level errors); nothing persisted
 *   F1.2 consent !== true                         → 400 'consent required'; nothing persisted
 *   F1.3 malformed JSON / wrong types             → 400 (zod); nothing persisted
 *   F1.4 answer option not a known option         → 400; nothing persisted
 *   F1.5 D1 write fails                            → 500 generic; log server-side; result + lead atomic
 *   F1.6 duplicate rapid re-submit (session_id)   → dedupe: update, or 409; no duplicate leads
 *   F1.7 extra/unknown fields                      → strip & ignore (do not error)
 *   F1.8 scoring produces an impossible state      → fail closed: 500, log, no partial row
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types';

const diagnostic = new Hono<HonoEnv>();

diagnostic.post('/submit', (c) =>
	c.json({ error: 'not_implemented', endpoint: 'POST /api/diagnostic/submit', milestone: 'B3' }, 501),
);

export default diagnostic;
