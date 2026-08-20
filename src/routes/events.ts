/**
 * Analytics event ingest (public). Mounted at /api/event.
 *
 * ── POST /api/event ─────────────────────────────────────────  (implement in B6)
 * Fire-and-forget analytics. No auth. Must never block or 500 the student (US-7 / F7).
 *
 * Request body (JSON):
 * {
 *   session_id: string,
 *   type: 'start' | 'advance' | 'contact_reached' | 'completed' | 'whatsapp_clicked',
 *   question_index?: number,   // set for 'advance'
 *   meta?: Record<string, unknown>
 * }
 *
 * Success 202: {}  (accepted)
 * Failures: rate-limited flood → 429 or silent drop (F7.1). Never 500 to the client.
 *
 * Note: the analytics *read* endpoint (GET /api/admin/analytics) is admin-gated and
 * therefore lives in routes/admin.ts, even though it reports on this table (BACKEND_SPEC §2).
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types';

const events = new Hono<HonoEnv>();

events.post('/', (c) => c.json({ error: 'not_implemented', endpoint: 'POST /api/event', milestone: 'B6' }, 501));

export default events;
