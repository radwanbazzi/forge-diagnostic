/**
 * Forge SAT Diagnostic — Cloudflare Worker (Hono).
 *
 * A single Worker that serves the JSON API under `/api/*`. In a later phase it
 * will also serve the Astro frontend's static assets; for now it is a
 * backend-only, `curl`-testable API (BACKEND_SPEC §2, "backend first").
 *
 * Route mounts mirror BACKEND_SPEC §2:
 *   /api/health      → health check              (implemented — B0)
 *   /api/diagnostic  → student submit            (stub → B3)
 *   /api/admin       → founder read/update + analytics, Access-protected (stub → B4–B6)
 *   /api/event       → analytics events          (stub → B6)
 */
import { Hono } from 'hono';
import type { HonoEnv } from './types';
import health from './routes/health';
import diagnostic from './routes/diagnostic';
import admin from './routes/admin';
import events from './routes/events';

const app = new Hono<HonoEnv>();

app.route('/api/health', health);
app.route('/api/diagnostic', diagnostic);
app.route('/api/admin', admin); // Access-protected in B4; the analytics read route lives here too
app.route('/api/event', events);

// Anything else under /api is a genuine 404 (no static-asset fall-through yet).
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
