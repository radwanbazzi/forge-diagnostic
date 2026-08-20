import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — generates D1/SQLite migrations into ./migrations from
 * the schema in src/db/schema.ts.
 *
 * Generate a migration:      npm run db:generate         (drizzle-kit generate)
 * Apply to local D1:         npm run db:migrate:local     (wrangler ... --local)
 * Apply to remote/prod D1:   npm run db:migrate:remote    (wrangler ... --remote)
 */
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/db/schema.ts',
	out: './migrations',
});
