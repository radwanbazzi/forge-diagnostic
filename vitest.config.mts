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
					bindings: { TEST_MIGRATIONS: migrations },
				},
			};
		}),
	],
	test: {
		setupFiles: ['./test/apply-migrations.ts'],
	},
});
