# Forge SAT Diagnostic — Backend

A single Cloudflare Worker (Hono + D1 + Drizzle) that scores SAT diagnostic
submissions server-side and saves each one as an auto-scored lead.

This is the **backend-first** phase: the whole API is testable with `curl` before
any frontend exists. The specs live in [`docs/PRD.md`](docs/PRD.md) and
[`docs/BACKEND_SPEC.md`](docs/BACKEND_SPEC.md) and are the source of truth.

## Prerequisites

- Node.js 18+ and npm
- No Cloudflare account is needed to run and test everything **locally**.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Then, in another terminal:

```bash
curl http://localhost:8787/api/health
# → {"ok":true,"time":"2026-08-20T12:34:56.789Z"}
```

## Test

```bash
npm test          # vitest: health endpoint + D1 schema round-trip
npm run typecheck # TypeScript type checking (no build output)
```

## Database (D1)

The schema (tables `diagnostics` and `events`) lives in
[`src/db/schema.ts`](src/db/schema.ts); the generated migration is in
[`migrations/`](migrations/).

```bash
npm run db:generate       # regenerate a migration after editing the schema
npm run db:migrate:local  # apply migrations to the local dev database
```

### Going to production (later)

`wrangler.jsonc` ships with a placeholder `database_id`. To create the real
(remote) database and deploy, run:

```bash
npx wrangler d1 create forge_diagnostic
```

Copy the `database_id` it prints into `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote   # apply the schema to the remote database
npm run deploy              # deploy the Worker
```

## Endpoints (contract)

| Method | Path                      | Status        |
| ------ | ------------------------- | ------------- |
| GET    | `/api/health`             | ✅ implemented |
| POST   | `/api/diagnostic/submit`  | stub → B3     |
| GET    | `/api/admin/leads`        | stub → B4     |
| GET    | `/api/admin/leads/:id`    | stub → B4     |
| PATCH  | `/api/admin/leads/:id`    | stub → B5     |
| POST   | `/api/event`              | stub → B6     |
| GET    | `/api/admin/analytics`    | stub → B6     |

Stubbed routes return `501 Not Implemented` with their intended request/response
shape documented in the route file's comments.
