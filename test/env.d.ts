// Augment the test environment (`import { env } from "cloudflare:test"`, typed as
// `Cloudflare.Env`) with the test-only migrations binding injected in vitest.config.mts.
// DB / WHATSAPP_NUMBER / WHISH_LINK are already on Cloudflare.Env via worker-configuration.d.ts.
declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
	}
}
