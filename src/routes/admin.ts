/**
 * Admin routes (founder only). Mounted at /api/admin.
 * Gated by Cloudflare Access AND re-verified in the Worker (defense-in-depth; added in B4).
 *
 * ── GET /api/admin/leads ────────────────────────────────────  (implement in B4)
 * List leads, newest-first, with computed fields + status.
 * Query: status?, program?, from?, to?, q? (name search), limit?, offset?
 * Success 200: { leads: [...], total: number }
 * Failures: 401 unauth (F3.1) · 400 invalid filter (F3.4) · 500 read fail (F3.5) · empty → 200 { leads: [], total: 0 } (F3.2/F3.3)
 *
 * ── GET /api/admin/leads/:id ────────────────────────────────  (implement in B4)
 * One lead: full row + parsed result_payload + derived whatsapp_message (US-6).
 * Success 200: { ...lead, result_payload: {...}, whatsapp_message: string }
 * Failures: 404 not found (F4.1) · 400 malformed id (F4.2) · 401 unauth (F4.3)
 *
 * ── PATCH /api/admin/leads/:id ──────────────────────────────  (implement in B5)
 * Update manual fields only (whitelist): { result_sent?, followup_status?, outcome?, notes? }
 * Success 200: the updated row.
 * Failures: 400 non-whitelisted field (F5.1) · 400 bad enum (F5.2) · 404 (F5.3) · 401 (F5.4)
 *
 * ── GET /api/admin/analytics ────────────────────────────────  (implement in B6)
 * Aggregates over the events table (kept admin-gated). Success 200:
 *   { completion_rate, funnel_by_question, status_mix, whatsapp_click_rate, enrollment_rate }
 * Failures: 401 · 500
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types';

const admin = new Hono<HonoEnv>();

const notImplemented = (endpoint: string, milestone: string) => ({ error: 'not_implemented', endpoint, milestone });

admin.get('/leads', (c) => c.json(notImplemented('GET /api/admin/leads', 'B4'), 501));
admin.get('/leads/:id', (c) => c.json(notImplemented('GET /api/admin/leads/:id', 'B4'), 501));
admin.patch('/leads/:id', (c) => c.json(notImplemented('PATCH /api/admin/leads/:id', 'B5'), 501));
admin.get('/analytics', (c) => c.json(notImplemented('GET /api/admin/analytics', 'B6'), 501));

export default admin;
