-- Removes ONLY the rows written by scripts/dev-seed.sql (F-M3b).
--
--   npx wrangler d1 execute forge_diagnostic --local --file scripts/dev-seed-clear.sql
--
-- Both deletes are tag-scoped, never a bare DELETE: leads must carry source = 'dev-seed'
-- and events must have a session id beginning 'dev-seed-'. A real submission can match
-- neither, so this is safe to run even against a database holding genuine rows.
DELETE FROM events WHERE session_id LIKE 'dev-seed-%';
DELETE FROM diagnostics WHERE source = 'dev-seed';
