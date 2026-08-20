# CLAUDE.md — Forge SAT Diagnostic (backend)

Persistent config for Claude Code. Keep this file short (< 200 lines).

## What this is

A commercial web app that gives a student an instant, personalized SAT readiness
result and saves every submission as an auto-scored lead. This repo is the
**backend** (a single Cloudflare Worker exposing a JSON API). The frontend
(Astro + React) is a later phase.

**Source of truth:** `docs/PRD.md` and `docs/BACKEND_SPEC.md`. Read them before
changing behavior. If this file or a request conflicts with those docs, the docs win —
stop and ask the owner (a non-technical founder; explain things in plain language).

## Stack (locked — do not substitute)

Cloudflare Workers · Hono · D1 (SQLite) · Drizzle ORM · Wrangler · Vitest.
Frontend (later): Astro + React islands. Admin auth (later): Cloudflare Access.

## Hard constraints

- Must stay on Cloudflare's **free** tier and be **commercial-legal**. No paid services.
- **10ms CPU per request**: lean handlers, no N+1 D1 queries, no heavy work in hot paths.
- The scoring **answer key lives ONLY server-side** in `src/lib/answerKey.ts`. Never ship it
  to the browser; never import anything under `web/` from it.
- **Never** put `ANTHROPIC_API_KEY` in any CI workflow (billing trap). Claude PR review
  uses a Pro-subscription OAuth token with `--max-turns 5`.
- Result + lead must persist **atomically** (US-1.5/1.8): fail closed, no partial rows.

## How we work

- Build **one milestone at a time** in the order of BACKEND_SPEC §6 (B0 → B7). After each,
  report (1) what changed in plain language, (2) exact test commands, (3) the DoD result,
  then **stop and wait** for confirmation.
- **Contract-first:** routes not yet in their milestone return `501` with the intended
  request/response shape documented as a comment.
- **Scoring is TDD:** write `test/scoring.test.ts` (golden cases Rami/Lina/Karim, PRD §17)
  with/ before `src/lib/scoring.ts`; it must be green before B3.
- Every failure case in BACKEND_SPEC §1 is a requirement, not optional.

## Layout

```
src/index.ts        Hono app; mounts /api/*
src/routes/         health (done) · diagnostic · admin · events (stubs → later)
src/db/             schema.ts (Drizzle) · client.ts (getDb)
src/lib/            scoring, answerKey, leadScore, resultCopy, whatsapp, validation, access (B2+)
src/types.ts        Bindings (env) + Hono env
migrations/         D1 SQL (drizzle-kit generate output)
test/               vitest (health, db round-trip; scoring + endpoints later)
docs/               PRD.md · BACKEND_SPEC.md  (source of truth)
```

## Commands

```bash
npm install                 # install deps
npm run dev                 # wrangler dev (local) — serves http://localhost:8787
npm test                    # vitest
npm run typecheck           # tsc (src + test)
npm run cf-typegen          # regenerate worker-configuration.d.ts after binding changes
npm run db:generate         # drizzle-kit generate (new migration from schema changes)
npm run db:migrate:local    # apply migrations to the LOCAL D1
npm run db:migrate:remote   # apply migrations to the REMOTE/prod D1 (needs real database_id)
```

## Status

- **B0 (scaffold + /api/health): done.**
- **B1 (D1 + schema + migration): done** (local). `database_id` in `wrangler.jsonc` is a
  placeholder until `wrangler d1 create forge_diagnostic` is run and the real id pasted in.
- **Next: B2 — scoring engine + golden tests** (do not start until owner confirms).
