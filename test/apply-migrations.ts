import { applyD1Migrations, env } from 'cloudflare:test';

// Applies migrations/0000_init.sql (and any later migrations) to the local test
// D1 before the suite runs, so every test starts against the real schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
