/**
 * Forge SAT Diagnostic — Cloudflare Worker (Hono).
 *
 * A single Worker serving the JSON API under `/api/*`. In a later phase it will also
 * serve the Astro frontend's static assets; for now it is a backend-only, curl-testable
 * API (BACKEND_SPEC §2).
 *
 * App-wide hardening (B7):
 *  - secureHeaders(): sensible security response headers on everything.
 *  - bodyLimit(): reject oversized request bodies with 413 (never 500 on a huge body).
 *  - onError(): any unhandled throw becomes a generic 500 — internal details never leak.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { HonoEnv } from './types';
import health from './routes/health';
import diagnostic from './routes/diagnostic';
import admin from './routes/admin';
import events from './routes/events';

/** Max request body: 32 KB. A full submission is ~1–2 KB, so this is generous headroom. */
const MAX_BODY_BYTES = 32 * 1024;

const app = new Hono<HonoEnv>();

app.use('*', secureHeaders());
app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }));

app.route('/api/health', health);
app.route('/api/diagnostic', diagnostic);
app.route('/api/admin', admin); // Access-protected; analytics read route lives here too
app.route('/api/event', events);

// Anything else under /api is a genuine 404 (no static-asset fall-through yet).
app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Safety net: never leak a stack trace or internal detail to the client.
app.onError((err, c) => {
	console.error('unhandled error', err);
	return c.json({ error: 'server_error' }, 500);
});

export default app;
