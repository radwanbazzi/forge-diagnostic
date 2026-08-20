# Forge SAT Diagnostic — Backend Build Spec (Cloudflare)

**Companion to `docs/PRD.md`.** This document supersedes PRD §6 (data model) and §14 (stack). PRD §7 (scoring), §8 (result copy), and §17 (acceptance criteria) remain authoritative and are referenced here.

**Stack:** Cloudflare Workers · Hono · D1 (SQLite) · Drizzle ORM · Astro + React islands (frontend, later phase) · Wrangler (deploy) · Cloudflare Access (admin auth) · GitHub Actions + Claude Code Action (CI/review).
**Cost:** $0, commercial-legal.
**Build order:** backend (API + D1, fully `curl`-testable) → frontend wired to endpoints → host + docs + CI.

---

## 1. User Stories WITH Failure Cases

Format: story, then the failure paths and the **required** behavior for each. Failure behavior is part of the acceptance criteria — an endpoint isn't "done" until its failures behave as specified.

### US-1 — Student submits a completed diagnostic
*As a student, I want to submit my answers and get my result, so I learn where I stand.*
- **Happy path:** valid payload → server scores it → persists one `diagnostics` row → returns the result payload (band, profile, fixes, timeline, program). 200.
- **F1.1 Missing/invalid required field** → 400 with a field-level error list; nothing persisted.
- **F1.2 Consent not `true`** → 400 "consent required"; nothing persisted.
- **F1.3 Malformed JSON / wrong types** → 400; nothing persisted (validate with zod before touching D1).
- **F1.4 Answer option string doesn't match a known option** → 400 (protects scoring integrity); nothing persisted.
- **F1.5 D1 write fails** → 500 generic message to client; full error logged server-side; **do not** return a result the student can't be saved against (result + lead must be atomic).
- **F1.6 Duplicate rapid re-submit (double-tap)** → dedupe on a client-generated `session_id`; a second write for the same session updates rather than duplicates (or is rejected 409). No duplicate leads.
- **F1.7 Extra/unknown fields in payload** → ignore them (strip), don't error.
- **F1.8 Scoring produces an impossible state** (e.g., band parse fails) → fail closed: 500, log, no partial row.

### US-2 — Student taps the WhatsApp CTA
*As a student, I want one tap to message Forge about my result.*
- **Happy path:** CTA builds `wa.me/<number>?text=<prefilled name+profile>`; fires a `whatsapp_clicked` event.
- **F2.1 WhatsApp number env var missing** → CTA still renders but points to a safe fallback (contact page/plain number); log a config warning. Never render a broken `wa.me/undefined`.
- **F2.2 Event write fails** → silent to the user (analytics must never block the student); retry once, then drop.

### US-3 — Founder views all leads
*As the founder, I want every completed diagnostic listed, scored, and statused, so I never touch a spreadsheet.*
- **Happy path (authenticated):** GET returns leads newest-first with computed fields + status. 200.
- **F3.1 Unauthenticated** → 401/redirect (Cloudflare Access blocks before the Worker; the Worker also verifies the Access JWT as defense-in-depth).
- **F3.2 Empty database** → 200 with `[]` (not an error).
- **F3.3 Filter with no matches** → 200 with `[]`.
- **F3.4 Invalid filter value** → 400 with allowed values.
- **F3.5 D1 read fails** → 500, logged.

### US-4 — Founder opens one lead
*As the founder, I want the full answers + the exact result the student saw.*
- **Happy path:** GET `/api/admin/leads/:id` → full row incl. `result_payload`. 200.
- **F4.1 id not found** → 404.
- **F4.2 id malformed (not uuid)** → 400.
- **F4.3 Unauthenticated** → 401.

### US-5 — Founder updates lead tracking
*As the founder, I want to set result-sent, follow-up status, outcome, and notes.*
- **Happy path:** PATCH updates only the manual fields; returns updated row. 200.
- **F5.1 Attempt to PATCH a computed/answer field** → 400 (whitelist manual fields only; never let the client mutate score/profile/answers).
- **F5.2 Invalid enum value** (e.g., outcome not in allowed set) → 400.
- **F5.3 id not found** → 404.
- **F5.4 Unauthenticated** → 401.
- **F5.5 Concurrent edits** → last-write-wins is acceptable for a single-admin tool; note it.

### US-6 — Founder copies a ready WhatsApp message
*As the founder, I want a pre-assembled result message per lead to paste into WhatsApp.*
- **Happy path:** endpoint/derived field returns the templated message for that lead's archetype + status.
- **F6.1 Lead missing a field the template needs** → fall back to a safe generic sentence for that slot; never emit `[brackets]` or `undefined`.

### US-7 — Analytics
*As the founder, I want completion rate and where students drop off.*
- **Happy path:** events recorded; analytics endpoint returns funnel by `question_index`, completion rate, status mix, WhatsApp-click rate.
- **F7.1 Event endpoint abused (flood)** → rate-limit per session/IP; excess dropped, not 500.
- **F7.2 Analytics query heavy** → keep it a simple aggregate; if it ever risks the 10ms CPU ceiling, precompute counts. Prefer COUNT/GROUP BY over row scans.

### US-8 — Platform stays inside the free tier
*As the founder, I want it to never cost money or break the CPU limit.*
- **F8.1 Worker approaches 10ms CPU** → scoring is pure arithmetic (fine); no heavy loops, no large JSON in hot paths, no per-request N+1 D1 queries.
- **F8.2 Approaching D1 daily write cap** (100k/day — irrelevant pre-scale) → log a warning threshold; documented upgrade path.

---

## 2. Project Scaffold (single repo, single Worker)

```
forge-diagnostic/
├─ docs/
│  ├─ PRD.md                     # product spec (already written)
│  └─ BACKEND_SPEC.md            # this file
├─ src/                          # the Worker (backend)
│  ├─ index.ts                   # Hono app; mounts /api/*, serves static assets
│  ├─ routes/
│  │  ├─ health.ts               # GET /api/health
│  │  ├─ diagnostic.ts           # POST /api/diagnostic/submit
│  │  ├─ admin.ts                # GET/PATCH /api/admin/leads[...]
│  │  └─ events.ts               # POST /api/event · GET /api/admin/analytics
│  ├─ lib/
│  │  ├─ scoring.ts              # PURE scoring engine (PRD §7). No I/O.
│  │  ├─ answerKey.ts            # server-only correct answers + points
│  │  ├─ leadScore.ts            # lead score + HOT/WARM/COLD (PRD §7.9–7.10)
│  │  ├─ resultCopy.ts           # builds result_payload copy (PRD §8)
│  │  ├─ whatsapp.ts             # builds wa.me link + founder copy message (US-6)
│  │  ├─ validation.ts           # zod schemas for all request bodies
│  │  └─ access.ts               # verify Cloudflare Access JWT (admin routes)
│  ├─ db/
│  │  ├─ schema.ts               # Drizzle table definitions
│  │  └─ client.ts               # drizzle(env.DB) helper
│  └─ types.ts                   # shared types (Answers, Computed, Env bindings)
├─ migrations/
│  └─ 0000_init.sql              # D1 schema (drizzle-kit generate output)
├─ test/
│  ├─ scoring.test.ts            # golden tests: Rami / Lina / Karim (PRD §17)
│  └─ endpoints.test.ts          # submit + admin happy/failure paths
├─ web/                          # Astro frontend (built in a later phase)
│  ├─ astro.config.mjs
│  └─ src/…                      # index.astro (SEO landing) + React islands
├─ public/                       # any static files
├─ wrangler.toml                 # Worker + D1 binding + static assets
├─ drizzle.config.ts
├─ vitest.config.ts
├─ tsconfig.json
├─ package.json
├─ .github/workflows/
│  ├─ ci.yml                     # typecheck + vitest + build (free, always runs)
│  └─ claude-review.yml          # @claude PR review via Pro OAuth, --max-turns 5
├─ CLAUDE.md                     # persistent Claude Code config (kept < 200 lines)
├─ .dev.vars                     # local secrets (gitignored)
└─ README.md
```

**Deploy model:** one Worker. `wrangler.toml` declares a D1 binding (`DB`) and a static-assets directory (`web/dist`). Requests matching a built static file are served directly; all other paths hit the Hono Worker, which routes `/api/*` and 404s the rest. No CORS (same origin). This honors "backend first": `/api/*` is fully testable via `curl` before `web/` exists.

**Key stubs to generate (contract only, no business logic yet in the scaffold phase):**

`wrangler.toml`
```toml
name = "forge-diagnostic"
main = "src/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "forge_diagnostic"
database_id = "<filled after `wrangler d1 create`>"

[assets]
directory = "web/dist"
binding = "ASSETS"
# /api/* has no static file → falls through to the Worker
```

`src/index.ts` (shape)
```ts
import { Hono } from "hono";
import health from "./routes/health";
import diagnostic from "./routes/diagnostic";
import admin from "./routes/admin";
import events from "./routes/events";

export type Env = { DB: D1Database; WHATSAPP_NUMBER: string; WHISH_LINK: string };

const app = new Hono<{ Bindings: Env }>();
app.route("/api/health", health);
app.route("/api/diagnostic", diagnostic);
app.route("/api/admin", admin);      // Access-protected
app.route("/api/event", events);
export default app;
```

---

## 3. Data Model (D1 / SQLite via Drizzle)

### Table: `diagnostics`
| column | type | notes |
|---|---|---|
| id | text PK | uuid (crypto.randomUUID) |
| session_id | text | client-generated, for dedupe (US-1.6) |
| created_at | integer | unix ms, default now |
| source | text null | UTM/source |
| completion_time_sec | integer null | |
| **answers (raw option strings)** | | |
| target_score, grade, test_date, sat_history | text | Q1–Q4 |
| q5,q6,q7,q8,q9,q10,q11,q12 | text | scored questions |
| hours_per_week, timing, review_mistakes, prep_status, worried_about | text | Q13–Q17 |
| **contact** | | |
| first_name, whatsapp | text | |
| school | text null | |
| respondent_type | text | 'student' \| 'parent' |
| consent | integer | 0/1, must be 1 |
| **computed (snapshot at submit)** | | |
| math_raw, rw_raw | integer | |
| overall_band | text | e.g. "1150-1320" |
| confidence | text | Moderate \| Low-Moderate \| Low |
| archetype | text | one of 5 |
| target_num, current_mid | integer | |
| gap | integer null | |
| timeline_verdict | text | |
| recommended_program | text | '$80 SAT Essentials' \| '$130 SAT Accelerator' |
| lead_score | real | |
| lead_status | text | HOT \| WARM \| COLD |
| result_payload | text (JSON) | exact rendered result |
| **admin (manual)** | | |
| result_sent | integer default 0 | |
| followup_status | text default 'None' | None\|Msg1 sent\|Msg2 sent\|Replied\|Not interested |
| outcome | text default '-' | -\|Enrolled $80\|Enrolled $130\|Lost |
| notes | text null | |

### Table: `events`
| column | type |
|---|---|
| id | text PK (uuid) |
| session_id | text |
| created_at | integer (unix ms) |
| type | text — start\|advance\|contact_reached\|completed\|whatsapp_clicked |
| question_index | integer null |
| meta | text null (JSON) |

**Security:** D1 has no public client; all access is through the Worker. Admin routes verify the Cloudflare Access JWT (`lib/access.ts`) in addition to Access gating the route. The answer key lives only in `src/lib/answerKey.ts` (server bundle) — never shipped to the browser.

---

## 4. Endpoint Contract (CRUD)

All JSON. Base path `/api`. Admin routes require a valid Cloudflare Access identity.

### `GET /api/health`
- 200 `{ ok: true, time: <iso> }`. No auth. (Smoke test target.)

### `POST /api/diagnostic/submit`  — **Create**
- Auth: none (public).
- Body: `{ session_id, source?, completion_time_sec?, answers: {…22 fields}, contact: { first_name, whatsapp, school?, respondent_type, consent } }`
- Validate (zod) → score (`lib/scoring`) → build payload (`lib/resultCopy`) → insert row → return.
- 200 `{ id, result_payload }` (result_payload = everything the result page renders).
- Failures: F1.1–F1.8 above (400 validation, 409 duplicate, 500 write/scoring).

### `GET /api/admin/leads`  — **List/Read**
- Auth: admin. Query: `status?`, `program?`, `from?`, `to?`, `q?` (name search), `limit?`, `offset?`.
- 200 `{ leads: [...], total }` newest-first.
- Failures: F3.1 (401), F3.4 (400 invalid filter), F3.5 (500).

### `GET /api/admin/leads/:id`  — **Read one**
- Auth: admin. 200 full row (+ `result_payload` parsed, + `whatsapp_message` from `lib/whatsapp`).
- Failures: F4.1 (404), F4.2 (400), F4.3 (401).

### `PATCH /api/admin/leads/:id`  — **Update (manual fields only)**
- Auth: admin. Body: any of `{ result_sent, followup_status, outcome, notes }` (whitelist).
- 200 updated row.
- Failures: F5.1 (400 non-whitelisted field), F5.2 (400 bad enum), F5.3 (404), F5.4 (401).

### `POST /api/event`  — **Create (analytics)**
- Auth: none. Body: `{ session_id, type, question_index?, meta? }`. 202 (accepted, fire-and-forget).
- Failures: F7.1 (rate-limited → 429 or silent drop). Never 500 to the client.

### `GET /api/admin/analytics`  — **Read (aggregate)**
- Auth: admin. 200 `{ completion_rate, funnel_by_question, status_mix, whatsapp_click_rate, enrollment_rate }`.
- Failures: 401, 500.

*(No DELETE endpoint in v1 — leads are never deleted from the UI. Data removal is a manual DB op if ever needed, per privacy request handling.)*

---

## 5. Scoring Engine (reference — full detail in PRD §7)

Implement `lib/scoring.ts` as a **pure** function `score(answers) → Computed`, unit-tested to reproduce the reference spreadsheet exactly. Non-negotiable golden tests (PRD §17):
- **Rami** → band `1150-1320`, Moderate, **Plateaued Retaker**, gap 165, **Aggressive**, **$130 Accelerator**, lead 11, **HOT**.
- **Lina** → band `1120-1300`, Low-Moderate, **Time-Pressured**, gap 90, **Comfortable**, **$130 Accelerator**, lead 6.5, **WARM**.
- **Karim** → band `880-1100`, Low, **Untested Unknown**, gap null, **Early / lots of runway**, **$80 Essentials**, lead 4, **COLD**.
Answer key + point values, band mapping, prior-score override, archetype precedence (top-down, first match), lead score, and program mapping are all specified in PRD §7.1–7.10. Match answers on the **leading letter** of the option string (`"C) 300" → "C"`).

---

## 6. Backend Milestones (build one at a time; stop for review after each DoD)

### B0 — Scaffold + health endpoint + local run
- **Goal:** running Worker on `wrangler dev` with Hono, TypeScript, folder structure, and a working `GET /api/health`.
- **Files:** `package.json`, `tsconfig.json`, `wrangler.toml`, `src/index.ts`, `src/routes/health.ts`, `src/types.ts`, `vitest.config.ts`, `.dev.vars`, `.gitignore`, `README.md`, `CLAUDE.md`.
- **Tests:** `next`—n/a; `vitest` runs (even if only a placeholder); `curl localhost:8787/api/health` → `{ok:true}`.
- **DoD:** `wrangler dev` serves `/api/health` locally; typecheck clean; committed.

### B1 — D1 database + schema + migration wired
- **Goal:** D1 created, Drizzle schema + generated migration applied locally; Worker can read/write a test row.
- **Files:** `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `migrations/0000_init.sql`, update `wrangler.toml` with `database_id`.
- **Tests:** a throwaway insert+select via a temp route or a Vitest against a local D1; `wrangler d1 execute` shows the tables.
- **DoD:** both tables exist locally; a row round-trips; migration reproducible from scratch.

### B2 — Scoring engine + golden tests
- **Goal:** pure `lib/scoring.ts` + `lib/leadScore.ts` + `lib/answerKey.ts`, reproducing PRD §7 exactly.
- **Tests:** `test/scoring.test.ts` — Rami/Lina/Karim pass with exact outputs; edge cases (band override, archetype precedence, null gap, seriousness cap) covered.
- **DoD:** `vitest` green; outputs match PRD §17 to the character.

### B3 — Submit endpoint (create) + result payload
- **Goal:** `POST /api/diagnostic/submit` — validate → score → build `result_payload` (`lib/resultCopy`, PRD §8) → persist → return.
- **Tests:** golden inputs → correct persisted row + payload; all F1.x failure paths behave; answer key absent from any client-reachable output.
- **DoD:** `curl` a full submission → one correct row in D1 + correct result JSON; failures return correct codes.

### B4 — Admin read endpoints
- **Goal:** `GET /api/admin/leads` (+ filters) and `GET /api/admin/leads/:id` with Access JWT verification.
- **Tests:** list/filter/search correct; 401 unauth; 404 missing; empty → `[]`.
- **DoD:** authed `curl` (with Access token) lists + reads leads; unauth blocked.

### B5 — Admin update endpoint
- **Goal:** `PATCH /api/admin/leads/:id` — whitelist manual fields, enum validation.
- **Tests:** F5.x paths; computed/answer fields immutable via API.
- **DoD:** manual fields update + persist; forbidden fields rejected.

### B6 — Events + analytics
- **Goal:** `POST /api/event` (fire-and-forget, rate-limited) + `GET /api/admin/analytics` aggregates.
- **Tests:** events insert; funnel/completion computed correctly on seeded data; flood → drop not 500.
- **DoD:** analytics returns correct numbers on seed data.

### B7 — Hardening
- **Goal:** zod validation everywhere, rate-limiting on public POSTs, Access verification finalized, env vars documented, CI green.
- **Tests:** full §1 failure matrix + PRD §17 backend criteria.
- **DoD:** all failure cases pass; `ci.yml` green; ready for the frontend phase.

---

## 7. Working Rules for the Implementer (Claude Code)
- Build **one milestone at a time**; after each, show what changed + its DoD result, then **stop and wait** for confirmation.
- **Contract first:** for the scaffold phase, stub route handlers to return `501 Not Implemented` with the intended shape documented — do NOT write business logic until its milestone.
- **Scoring is TDD:** write `test/scoring.test.ts` (golden cases) before/with `lib/scoring.ts`; it must go green before B3.
- **Answer key server-only.** Never import `answerKey.ts` into anything under `web/`.
- **Fail closed & atomic:** result + lead persist together or not at all (US-1.5/1.8).
- **Never** put `ANTHROPIC_API_KEY` in CI (billing trap). Claude review uses Pro OAuth, `--max-turns 5`.
- Keep handlers lean (10ms CPU ceiling): no N+1 D1 queries, no heavy synchronous work in the request path.
- Every endpoint's failure cases from §1 are acceptance criteria, not optional.
