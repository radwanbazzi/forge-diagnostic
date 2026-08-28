# Forge SAT Diagnostic — Backend

A single Cloudflare Worker (Hono + D1 + Drizzle) that scores SAT diagnostic submissions
server-side and saves each one as an auto-scored lead, with an admin API for the founder.

The whole API is testable with `curl` before any frontend exists. The specs are the source
of truth: [`docs/PRD.md`](docs/PRD.md) and [`docs/BACKEND_SPEC.md`](docs/BACKEND_SPEC.md).

## Prerequisites

- Node.js 18+ and npm.
- No Cloudflare account is needed to run and test everything **locally**.

## Install, run, test

```bash
npm install
```

```bash
npm run dev          # local server at http://localhost:8787
```

```bash
npm test             # full test suite (Vitest)
npm run typecheck    # TypeScript, no emit
```

> Windows/PowerShell users: in the `curl` examples below use `curl.exe` and `NUL`
> (instead of `curl` and `/dev/null`).

## API

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| GET | `/api/health` | none | Health check |
| POST | `/api/diagnostic/submit` | none | Score a submission, save a lead, return the result |
| POST | `/api/event` | none | Fire-and-forget analytics beacon |
| GET | `/api/admin/leads` | admin | List leads (filter/search/page) |
| GET | `/api/admin/leads/:id` | admin | One lead + result + WhatsApp message |
| PATCH | `/api/admin/leads/:id` | admin | Update manual tracking fields |
| GET | `/api/admin/analytics` | admin | Funnel metrics |

### Admin auth locally

Admin routes are protected by **Cloudflare Access** in production. Locally there is a
**dev-only bypass**: send these two headers (values come from `.dev.vars`):

```
X-Dev-Access-Email: founder@example.com
X-Dev-Access-Secret: local-dev-secret-change-me
```

This bypass is **impossible in production** — see [Security](#security).

## Database (D1)

Schema: [`src/db/schema.ts`](src/db/schema.ts) → tables `diagnostics` (leads) and `events`.
Migrations: [`migrations/`](migrations/).

```bash
npm run db:generate       # regenerate a migration after editing the schema
npm run db:migrate:local  # apply migrations to the local dev database
```

## Security

- **Answer key is server-only** ([`src/lib/answerKey.ts`](src/lib/answerKey.ts)), imported
  only by the scoring module. It is never sent to the browser.
- **Input validation** (zod) on every request; unknown answer options are rejected.
- **Request body size limit**: 32 KB → `413` (never a 500 on a huge body).
- **Rate limits** on public POSTs (per-isolate, in-memory, free-tier friendly):
  `POST /api/diagnostic/submit` = 30/min per IP; `POST /api/event` = 60/min per IP+session.
  Excess → `429`.
- **Security headers** on all responses (`secureHeaders`).
- **Admin auth** = Cloudflare Access JWT, verified in the Worker (signature + audience +
  issuer + expiry + your email). Unauthenticated `/api/admin/*` → `401`.
- **Errors never leak internals**: server failures return a generic `{ "error": "server_error" }`.
- Only a random `session_id` is used client-side; no PII in analytics beacons.

### Why the local dev bypass can't work in production

Two independent safeguards, both must hold for the bypass to activate:

1. `DEV_ADMIN_SECRET` must be set — it lives only in `.dev.vars` (git-ignored) and is
   **never** deployed as a production secret.
2. `ACCESS_AUD` must be **unset** — production sets it (when you wire Cloudflare Access),
   which **force-disables** the bypass regardless of any secret.

So in production the only way in is a real, signature-verified Cloudflare Access token for
your email.

---

## Deploy checklist (what you personally do at deploy time)

Everything below is a one-time setup. Run from this folder.

1. **Log in to Cloudflare**
   ```bash
   npx wrangler login
   ```
2. **Create the real database** and paste its id into `wrangler.jsonc` (replace the
   `database_id` placeholder):
   ```bash
   npx wrangler d1 create forge_diagnostic
   ```
3. **Apply the schema to the remote database**
   ```bash
   npm run db:migrate:remote
   ```
4. **Set the production values** (these are NOT in git; do not set `DEV_ADMIN_SECRET`):

   | Name | What it is | How to set |
   | ---- | ---------- | ---------- |
   | `WHATSAPP_NUMBER` | Forge's WhatsApp number (digits) | `npx wrangler secret put WHATSAPP_NUMBER` |
   | `WHISH_LINK` | Whish payment link | `npx wrangler secret put WHISH_LINK` |
   | `ADMIN_EMAIL` | Your founder email (the only admin) | `npx wrangler secret put ADMIN_EMAIL` |
   | `ACCESS_TEAM_DOMAIN` | `https://<your-team>.cloudflareaccess.com` | `npx wrangler secret put ACCESS_TEAM_DOMAIN` |
   | `ACCESS_AUD` | Your Access application's AUD tag | `npx wrangler secret put ACCESS_AUD` |

   > `WHATSAPP_NUMBER` and `WHISH_LINK` are not secret; you may instead put them in
   > `wrangler.jsonc` under `"vars"`. Setting `ACCESS_AUD` is what turns the real admin lock on.
5. **Configure Cloudflare Access** (Zero Trust → Access → Applications): protect the
   `/admin` and `/api/admin` paths with a policy that allows **only your email**. This is
   where the team domain and AUD tag in step 4 come from.
6. **Deploy**
   ```bash
   npm run deploy
   ```
7. **Verify the lock**: an unauthenticated request to any `/api/admin/*` route must redirect
   or return `401`, and you (logged in via Access) can list leads.

## Continuous integration (GitHub Actions — free)

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs **typecheck + tests + build**
  on every push and pull request. No secrets required.
- [`.github/workflows/claude-review.yml`](.github/workflows/claude-review.yml) runs a Claude
  Code review **only when you comment `@claude` on a pull request**, capped at
  `--max-turns 5`. It uses your **Pro/Max subscription** via an OAuth token — **never an API
  key** (which would bill you).

  One-time setup: generate a token in the Claude Code CLI with `claude setup-token`, then add
  it as a repository secret named **`CLAUDE_CODE_OAUTH_TOKEN`** (GitHub → Settings → Secrets
  and variables → Actions). Do **not** add `ANTHROPIC_API_KEY`.

## Everything you must do at deploy time (quick list)

- [ ] `wrangler login`
- [ ] `wrangler d1 create forge_diagnostic` → paste `database_id` into `wrangler.jsonc`
- [ ] `npm run db:migrate:remote`
- [ ] Set `WHATSAPP_NUMBER`, `WHISH_LINK`, `ADMIN_EMAIL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`
- [ ] Create the Cloudflare Access application (allow only your email)
- [ ] `npm run deploy`
- [ ] Add the `CLAUDE_CODE_OAUTH_TOKEN` GitHub secret (for `@claude` PR reviews)
- [ ] Confirm unauthenticated `/api/admin/*` is blocked
