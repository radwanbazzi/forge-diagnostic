/**
 * GET /api/health  (B0)
 *
 * Smoke-test endpoint. No auth.
 * Response 200: { ok: true, time: <ISO-8601 string> }
 */
import { Hono } from 'hono';
import type { HonoEnv } from '../types';

const health = new Hono<HonoEnv>();

health.get('/', (c) => c.json({ ok: true, time: new Date().toISOString() }));

export default health;
