/**
 * Shared types for the Forge SAT Diagnostic Worker.
 *
 * `Bindings` describes the resources and environment variables the Worker
 * receives at runtime (declared in wrangler.jsonc + .dev.vars). Hono exposes
 * these on `c.env`. After changing bindings, run `npm run cf-typegen` to keep
 * the generated global types (worker-configuration.d.ts) in sync.
 */

/** Cloudflare resource + env bindings available on `c.env`. */
export interface Bindings {
	/** D1 (SQLite) database — the only datastore. Never exposed to the browser. */
	DB: D1Database;
	/** Forge WhatsApp number used to build the pre-filled wa.me CTA link. */
	WHATSAPP_NUMBER: string;
	/** Whish payment link shown on the result screen. */
	WHISH_LINK: string;
}

/** Hono generic env: binds `c.env` to our `Bindings`. */
export interface HonoEnv {
	Bindings: Bindings;
}
