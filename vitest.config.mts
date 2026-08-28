import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest(async () => {
			// Read the generated D1 migrations and hand them to tests as a binding,
			// so the setup file can apply them to the local test database.
			const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));
			const migrations = await readD1Migrations(migrationsPath);
			return {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					// Test env values (so tests don't depend on .dev.vars and CI runs green).
					// ACCESS_AUD is intentionally unset → the local-dev admin bypass is active in tests.
					bindings: {
						TEST_MIGRATIONS: migrations,
						ADMIN_EMAIL: 'founder@example.com',
						DEV_ADMIN_SECRET: 'local-dev-secret-change-me',
						WHATSAPP_NUMBER: '9610000000',
						WHISH_LINK: 'https://whish.money/pay/test',
					},
				},
			};
		}),
	],
	test: {
		setupFiles: ['./test/apply-migrations.ts'],
	},
});
