# Forge SAT Diagnostic — Product Requirements & Build Spec

**Owner:** Founder (Bazzi) · **Product Owner/Architect:** (this doc) · **Implementation:** Claude Code
**Version:** 2.0 · **Status:** Approved for build
**Companion doc:** `docs/BACKEND_SPEC.md` (Cloudflare-native scaffold, data model, endpoint contract, backend milestones).

> **v2.0 change note:** Stack migrated from Next.js + Supabase + Vercel to **Cloudflare Workers + Hono + D1 + Drizzle + Astro**. Reason: Vercel's free Hobby tier prohibits commercial use (a paid academy would violate its ToS); Cloudflare's free Workers tier permits commercial use and its limits far exceed pre-scale needs. Product logic, scoring engine (§7), result copy (§8), and golden tests (§17) are unchanged from v1.

---

## 0. One-paragraph summary

A branded, mobile-first web app where a prospective SAT student answers ~22 questions in ~8 minutes and **instantly** receives a personalized, on-screen SAT readiness result (estimated score band, student profile, real bottleneck, top-3 fixes, timeline verdict, program recommendation). Every submission is automatically scored **server-side** and saved to a **lead dashboard** with a HOT/WARM/COLD status, eliminating all manual data entry. The primary conversion action is a one-tap, pre-filled WhatsApp message to Forge. The founder sends WhatsApp follow-ups manually; the app does not send messages, book calls, or process payments.

**This app is a UI + persistence wrapper around an already-verified scoring engine.** The logic is fully specified in Section 7 and must reproduce the reference spreadsheet exactly (three golden test cases in Section 17).

---

## 1. Product Requirements Document

### 1.1 Problem
The Google Forms MVP can auto-score but cannot (a) show the student an instant result or (b) save leads without manual spreadsheet transfer. The founder will not do manual data entry. Slow, hand-sent results also let hot leads go cold.

### 1.2 Goal
Convert Instagram/WhatsApp/referral traffic into qualified, scored leads by delivering a genuinely useful free diagnostic whose result quality earns the sale — with zero manual data handling.

### 1.3 Success metrics (instrument these)
- **Completion rate** (starts → finished) — target ≥ 55%
- **WhatsApp CTA click rate** (finished → tapped WhatsApp) — target ≥ 40%
- **HOT/WARM lead share** of completions
- **Per-question drop-off** (where people quit)
- **Enrollment rate** from lead (manual outcome field)

### 1.4 Positioning guardrail
Framed as *"get clarity on where you stand,"* never a sales quiz. The full result is given free; the only gate is WhatsApp contact captured *before* the result renders. No fake "unlock your score" locks.

### 1.5 Non-goals (v1)
No auto-sending of WhatsApp/email. No consultation booking. No payment processing (Whish link only). No adaptive/IRT testing. No student accounts.

---

## 2. User Stories

**Student (primary)**
- As a student, I want to see how I'd score and what's holding me back, so I can study the right things.
- As a student, I want the result immediately on screen, so I don't wait for an email.
- As a student, I want it to work fast on my phone on mobile data.
- As a student, I want one tap to ask Forge about my results.

**Parent (secondary)**
- As a parent completing on my child's behalf, I want a credible read and a clear recommendation and price.

**Founder / Admin**
- As the founder, I want every completed diagnostic saved automatically with score, profile, and HOT/WARM/COLD status, so I never transfer data by hand.
- As the founder, I want to filter leads by status and see the exact result the student saw.
- As the founder, I want to record follow-up status, outcome, and notes per lead.
- As the founder, I want to see completion rate and per-question drop-off.

*(Full user stories WITH failure cases live in `BACKEND_SPEC.md` §1.)*

---

## 3. User Flows

### 3.1 Student flow
```
Landing (value prop, "Start" CTA)  — static, SEO-friendly (Astro)
  → Section 1: goal + context (4 Q)
  → Section 2: skills check (8 Q, easy→hard)
  → Section 3: study habits (5 Q)
  → Contact capture (name, WhatsApp, school[opt], student/parent, consent)  ← REQUIRED before result
  → [POST /api/diagnostic/submit — server scores + persists lead]
  → Result page (instant, personalized, on-screen)
      • estimated band + confidence + caveat
      • profile/archetype
      • the reframe (self-perceived vs actual)
      • section read
      • top-3 fixes ranked
      • timeline verdict
      • program recommendation ($80/$130)
      • WhatsApp CTA (pre-filled) + Whish note
```

### 3.2 Admin flow
```
Login (Cloudflare Access — gates /admin to founder's email; no app-level password)
  → Dashboard: leads table (newest first), status color-coded
      • filter by status / program / date
      • search by name
  → Lead detail: full answers + computed result + the exact rendered result
      • editable: result_sent, followup_status, outcome, notes
      • one-click "copy WhatsApp message"
  → Analytics: completion rate, per-question drop-off, funnel, status mix
```

---

## 4. Functional Requirements

- **F1** Render 22 questions across 4 sections with a persistent progress indicator.
- **F2** All questions required except school (Q20). Client-side validation before advancing.
- **F3** Contact capture screen appears after all questions, before result. Consent checkbox required.
- **F4** On submit, POST all answers to `POST /api/diagnostic/submit`, which computes the full result server-side and persists a lead row, then returns the result payload.
- **F5** Answer key and scoring logic exist **only server-side** (in the Worker bundle); never in the browser/client bundle or any client-readable response before submit.
- **F6** Result page renders the returned payload with dynamic, profile-specific copy.
- **F7** WhatsApp CTA opens `wa.me/<number>?text=<prefilled>` with the student's name + profile encoded.
- **F8** Admin dashboard lists all leads with computed fields and color-coded status.
- **F9** Admin can edit `result_sent`, `followup_status`, `outcome`, `notes`; these persist.
- **F10** Capture lightweight analytics events (start, per-question advance, contact-reached, completed, whatsapp-clicked).
- **F11** Capture UTM/source params from the landing URL and store on the lead.
- **F12** Result is snapshotted at submit-time; later logic changes do not alter historical leads.

---

## 5. Non-Functional Requirements

- **Mobile-first**, works well at 360px width; thumb-friendly targets.
- **Fast on poor connections** (Lebanon): first meaningful paint < 2s on 3G; minimal JS; static-generated landing (Astro); no heavy media on the flow.
- **Availability:** served from Cloudflare's edge (Workers + static assets). Student flow makes one scoring API call to the same Worker; no cross-origin round-trip.
- **Cost/compliance:** must run entirely on Cloudflare's **free** tier and be **commercial-legal**. Respect the Worker 10ms-CPU-per-request limit (scoring is pure arithmetic; no N+1 database queries in the request path).
- **Security:** answer key server-only; admin routes gated by Cloudflare Access **and** verified in the Worker (defense-in-depth); D1 has no public client (all access via the Worker); input validation (zod) on every endpoint.
- **Accessibility:** semantic HTML, labeled inputs, sufficient contrast (Forge palette meets AA for text), keyboard navigable.
- **Maintainability:** scoring logic isolated in one pure, unit-tested module (`src/lib/scoring.ts`).
- **Privacy:** collect only what's needed; explicit consent; minors handled (see §12).

---

## 6. Data Model (Cloudflare D1 / SQLite via Drizzle)

> SQLite has no native boolean/uuid/jsonb/timestamptz types: booleans are stored as integer 0/1, ids as text (uuid via `crypto.randomUUID()`), JSON as text, timestamps as integer unix-ms. Full column list + Drizzle notes in `BACKEND_SPEC.md` §3.

### Table: `diagnostics`
| column | type | notes |
|---|---|---|
| id | text (pk) | uuid |
| session_id | text | client-generated per attempt (dedupe) |
| created_at | integer | unix ms, default now |
| source | text null | UTM/source |
| completion_time_sec | integer null | |
| **Answers** | | |
| target_score | text | Q1 raw option |
| grade | text | Q2 |
| test_date | text | Q3 |
| sat_history | text | Q4 |
| q5..q12 | text x8 | selected option strings ("C) 300" etc.) |
| hours_per_week | text | Q13 |
| timing | text | Q14 |
| review_mistakes | text | Q15 |
| prep_status | text | Q16 |
| worried_about | text | Q17 |
| **Contact** | | |
| first_name | text | |
| whatsapp | text | |
| school | text null | |
| respondent_type | text | 'student' \| 'parent' |
| consent | integer | 0/1, must be 1 to submit |
| **Computed (snapshot)** | | |
| math_raw | integer | |
| rw_raw | integer | |
| overall_band | text | e.g. "1040-1200" |
| confidence | text | Moderate \| Low-Moderate \| Low |
| archetype | text | one of the 5 |
| target_num | integer | |
| current_mid | integer | |
| gap | integer null | |
| timeline_verdict | text | |
| recommended_program | text | '$80 SAT Essentials' \| '$130 SAT Accelerator' |
| lead_score | real | |
| lead_status | text | HOT \| WARM \| COLD |
| result_payload | text (JSON) | the exact rendered result (copy strings) |
| **Admin (manual)** | | |
| result_sent | integer default 0 |
| followup_status | text default 'None' |
| outcome | text default '-' |
| notes | text null |

### Table: `events` (analytics)
| column | type |
|---|---|
| id | text pk (uuid) |
| session_id | text (client-generated per attempt) |
| created_at | integer (unix ms) |
| type | text (start \| advance \| contact_reached \| completed \| whatsapp_clicked) |
| question_index | integer null |
| meta | text null (JSON) |

**Access control:** D1 is never exposed to the browser; all reads/writes go through the Worker. Public traffic can only reach `POST /api/diagnostic/submit` and `POST /api/event`. Admin read/update endpoints are gated by Cloudflare Access (only the founder's email) and re-verified in the Worker.

---

## 7. Scoring Engine Requirements (port verbatim from the reference spreadsheet)

Implement as one pure module `src/lib/scoring.ts`, no I/O, fully unit-tested. Inputs = the answer object; output = all computed fields.

### 7.1 Answer key & points
| Q | Correct | Section | Points |
|---|---|---|---|
| Q5 | C | Math | 1 |
| Q6 | B | R&W | 1 |
| Q7 | B | Math | 2 |
| Q8 | B | R&W | 2 |
| Q9 | B | Math | 2 |
| Q10 | B | R&W | 2 |
| Q11 | A | Math | 3 |
| Q12 | B | R&W | 3 |
Match on the leading letter of the stored option (`"C) 300"` -> `"C"`). `math_raw` max 8, `rw_raw` max 8. Answer key lives in `src/lib/answerKey.ts` (server bundle only).

### 7.2 Section band from raw (each section, of 8)
Per-point curve (each section, raw 0-8 -> `[low-high]`):

| raw | band | raw | band |
|---|---|---|---|
| 8 | `680-720` | 3 | `320-390` |
| 7 | `560-610` | 2 | `270-340` |
| 6 | `500-560` | 1 | `230-300` |
| 5 | `440-500` | 0 | `200-260` |
| 4 | `380-450` | | |

`est_low` = sum of section lows; `est_high` = sum of section highs.

**Perfect-run special rule:** a full 8/8 in **both** sections (16/16 total) **and** no prior
score reported (`sat_history` = "Never taken one") -> top band `1400-1500` exactly. This is the
**only** way to reach `1400-1500` via the estimate; any single wrong answer drops back onto the
per-point curve (so 15/16 -> `1240-1330`). A reported prior score always defers to the §7.3
override, so this rule never fires for official/practice history.

> Note: raw 8 in a single section (band `680-720`) is only reachable in a non-perfect total
> (e.g. 15/16 = 8 + 7); a 16/16 total is intercepted by the perfect-run rule above.

### 7.3 Overall band (prior score OVERRIDES our estimate — conservative)
- Official + 1300+ -> `1250-1400`
- Official + under 1100 -> `900-1040`
- Official + 1100-1299 -> `1040-1200`
- Practice + 1300+ -> `1080-1240`
- Practice + under 1100 -> `840-1000`
- Practice + 1100-1299 -> `960-1120`
- Never taken -> `est_low-est_high` (or `1400-1500` for a perfect run, §7.2)

### 7.4 Confidence
Official -> `Moderate` · Practice -> `Low-Moderate` · Never -> `Low`.
*(No "High" is produced by v1 — reserved for future full-mock integration.)*

### 7.5 Archetype (top-down, FIRST match wins)
1. timing (Q14) contains "Run out" -> **Time-Pressured**
2. `abs(math_raw - rw_raw) >= 3` -> **Lopsided (Math-weak)** if math<rw else **Lopsided (R&W-weak)**
3. Q12 correct (B) AND Q10 wrong (!=B) -> **Shaky Grammarian**
4. sat_history != "Never taken one" -> **Plateaued Retaker**
5. else -> **Untested Unknown**

### 7.6 Target number
`Under 1100 -> 1050 · 1100-1249 -> 1175 · 1250-1349 -> 1300 · 1350-1449 -> 1400 · 1450+ -> 1500 · Not sure -> 0`

### 7.7 current_mid & gap
`current_mid` = midpoint of `overall_band`. `gap` = `target_num - current_mid` (null if target_num=0).

### 7.8 Timeline verdict
- test_date "Within 8 weeks": gap >= 100 -> **Aggressive**, else **Tight but doable**
- "2-4 months" -> **Reasonable**
- "4-6 months" -> **Comfortable**
- "More than 6 months" / "No date set" -> **Early / lots of runway**

### 7.9 Lead score (0-11)
- **urgency**: Within 8wk = 3 · 2-4mo = 2 · else = 1
- **gap**: null -> 1 · >=150 -> 3 · >=80 -> 2 · else 1
- **seriousness** (cap 3): hours(>8=2, 5-8=1, 2-4=1, <2=0) + target set(+1 unless "Not sure") + prep("Not really"/"On my own"=+1, "school"=+0.5, "another tutor"=0)
- **contact**: whatsapp present +1, school present +1 (cap 2)
- `lead_score` = sum. **HOT >= 8 · WARM 5-7 · COLD <= 4.**

### 7.10 Program recommendation
`lead_status == COLD` OR `archetype == Untested Unknown` -> **$80 SAT Essentials**; else **$130 SAT Accelerator**.

---

## 8. Result-Generation Logic (on-screen copy)

The result page renders these blocks from the payload. Copy is templated per archetype; `[brackets]` filled from computed fields. Built by `src/lib/resultCopy.ts` at submit time and stored in `result_payload`.

- **Band header:** "Your estimated SAT range: **[overall_band]**" · sub: "[confidence] confidence — a full timed mock narrows this considerably."
- **Profile:** "You're **[archetype]**." + one-line meaning (map below).
- **The reframe** (only when data contradicts self-report): "You told us **[worried_about]** worried you most — but your answers point to **[real_bottleneck]**. That's actually good news: it's faster to fix." If self-report matches data, affirm instead.
- **Section read:** plain-language Math vs R&W standing from raw scores.
- **Top-3 fixes:** ranked list by archetype (map below).
- **Timeline verdict:** "[timeline_verdict] — [one line tied to gap + test_date]."
- **Recommendation:** name `recommended_program`, tie its 1-2 features to their bottleneck; mention Score Improvement Guarantee only for Accelerator, with baseline = Week-1 full mock.
  - **Gap line (target-aware framing):** when the student named a target (`target_num > 0`) **and** the estimate falls short (`gap > 0`), append a line that names the target and the gap and positions Forge as the bridge — e.g. *"You're aiming for [target_num], and your estimate sits around [current_mid]. That's a [gap]-point gap — exactly the kind of distance a structured Forge plan is built to close."* If the target is "Not sure" (`gap` null) or the estimate already meets/exceeds the target (`gap <= 0`), omit the line. This is **copy only**: the target changes the framing/urgency, **never** the band/`current_mid`/`gap`/archetype/lead score/program — two identical answer sets with different targets always produce the same band. Never promise a guaranteed score.
- **CTA:** WhatsApp button (pre-filled) + "Payment is quick via Whish."

**Archetype -> meaning / real_bottleneck / top-3 fixes**
- **Time-Pressured** — "the clock, not the content." Fixes: pacing drills · skip-and-return system · timed full sections.
- **Lopsided (Math-weak)** — "Math is dragging a solid R&W score." Fixes: ~70% effort on Math · targeted concept work · hold R&W steady.
- **Lopsided (R&W-weak)** — "R&W is dragging a solid Math score." Fixes: ~70% effort on R&W · reading/grammar targeting · hold Math steady.
- **Shaky Grammarian** — "reading's fine; punctuation/grammar rules leak points." Fixes: the ~6 boundary/punctuation rules · transitions · timed R&W.
- **Plateaued Retaker** — "stuck converting near-misses, not lacking basics." Fixes: mistake-pattern analysis · full timed mock · targeted weak-area work.
- **Untested Unknown** — "not enough data to pinpoint yet — normal this early." Fixes: one full timed mock for a baseline · set target + date · weekly routine.

---

## 9. Admin Requirements
- **Cloudflare Access** login (single admin = founder's email). No app-level password, no public admin route. The Worker re-verifies the Access identity on every `/api/admin/*` call.
- Leads table: newest first; columns name, created, status (color), archetype, program, gap, whatsapp, result_sent, followup_status, outcome.
- Filters: status, program, date range; search by name.
- Lead detail: all answers + all computed fields + the exact rendered result + editable manual fields + copy-WhatsApp-message.
- Color coding: HOT red, WARM amber, COLD grey.

## 10. Lead-Management Requirements
- Every completed submission = one lead row, auto-scored, no manual entry.
- Manual fields editable and persisted: `result_sent`, `followup_status` (None/Msg1 sent/Msg2 sent/Replied/Not interested), `outcome` (-/Enrolled $80/Enrolled $130/Lost), `notes`.
- One-click "copy WhatsApp message" on lead detail that assembles the templated result text for that lead (founder pastes into WhatsApp).

## 11. Analytics / Events
- Fire events: `start`, `advance` (with question_index), `contact_reached`, `completed`, `whatsapp_clicked`.
- Analytics view computes: completion rate, per-question drop-off (funnel by question_index), status mix, WhatsApp click rate, enrollment rate (from outcome).

## 12. Privacy / Security
- Consent checkbox required; store `consent=1` with timestamp (created_at).
- Minor-awareness line in consent ("If you're under 18, please make sure a parent knows"). Collect no more than needed; no ID, no payment data.
- Answer key & scoring server-only (Worker bundle). Admin data behind Cloudflare Access + Worker-side verification. Validate/sanitize API input (zod). Rate-limit public POST endpoints. No PII in client analytics/localStorage beyond a random session_id.
- Privacy note on landing + contact screen: data used only to send results and Forge updates, never shared.

## 13. UI Requirements (Forge brand)
- **Palette:** Bone `#F2EFE6` (bg), Ink `#141310` (text), Molten Red `#D4331F` (accent/CTA). Amber `#C9A227` and grey `#8A857A` for status only.
- **Type:** Anton for display/wordmark; IBM Plex Mono for numerals/score data; a clean sans (Inter/system) for body.
- **Motif:** Score Gauge (the horizontal tick-scale with the red marker) used on the result band header.
- One question per screen on mobile; large tap targets; progress bar; smooth advance. No stock education clip-art, no graduation caps.

## 14. Technology Stack (FINAL — Cloudflare-native, free, commercial-legal)
- **Host / runtime:** Cloudflare Workers (free tier permits commercial use; global edge).
- **API framework:** Hono (Cloudflare-native, TypeScript).
- **Database:** Cloudflare D1 (SQLite), bound to the Worker.
- **ORM / migrations:** Drizzle ORM.
- **Frontend:** Astro (static-generated, SEO-friendly landing) + React "islands" for the interactive diagnostic flow and admin dashboard. Styled with the Forge tokens (§13).
- **Deploy:** single Worker serving `/api/*` (Hono) + static assets (Astro `dist/`) via Wrangler. Same origin — no CORS.
- **Admin auth:** Cloudflare Access (Zero Trust, free <=50 users) gating `/admin`, re-verified in the Worker.
- **Scoring:** pure TypeScript module, server-side only.
- **Analytics:** own `events` table in D1 (no third-party for v1).
- **Testing:** Vitest (scoring golden tests + endpoint tests).
- **CI / PR review:** GitHub Actions (free; typecheck + Vitest + build) + Claude Code GitHub Action via **Pro-subscription OAuth token, never an API key**, `--max-turns 5`, triggered by `@claude` PR comments. Public repo -> free Actions minutes.

## 15. MVP Boundaries (in scope)
Student diagnostic flow · server-side scoring · instant on-screen result · lead persistence (D1) · admin dashboard (Cloudflare Access) with manual fields · basic analytics (completion + drop-off) · WhatsApp CTA · consent/privacy · Forge branding.

## 16. Out of Scope (explicit — do NOT build in v1)
Auto-sending WhatsApp or email · consultation/call booking · payment processing (Whish link only) · adaptive/IRT testing · per-question timers (stretch, not v1) · student accounts/login · multi-admin roles · email result delivery · A/B testing framework · CMS for questions (questions live in a typed config file) · record deletion from the UI.

## 17. Acceptance Criteria

**Scoring engine (golden tests — must match the reference spreadsheet exactly):**
- **Rami** (target 1350-1449; Grade 12; Within 8 weeks; Official 1100-1299; Q-answers giving math_raw=5, rw_raw=6 with Q10 correct; timing "right on time"; hours 5-8; prep "On my own"; whatsapp+school present) -> band `1040-1200`, confidence Moderate, archetype **Plateaued Retaker**, current_mid 1120, gap 280, timeline **Aggressive**, program **$130 Accelerator**, lead_score 11, status **HOT**.
- **Lina** (target 1250-1349; Grade 11; 4-6 months; Practice 1100-1299; math_raw=6, rw_raw=6; timing "Run out..."; hours 2-4; prep "school"; whatsapp only) -> band `960-1120`, confidence Low-Moderate, archetype **Time-Pressured**, current_mid 1040, gap 260, timeline **Comfortable**, program **$130 Accelerator**, lead_score 7.5, status **WARM**. *(lead_score rose from 6.5 to 7.5: the lowered band widens the gap to 260, which crosses the ≥150 gap sub-score threshold; status stays WARM.)*
- **Karim** (target Not sure; Grade 10; No date; Never; math_raw=2, rw_raw=4; timing "never done timed"; hours <2; prep "Not really"; whatsapp only) -> band `650-790`, confidence Low, archetype **Untested Unknown**, current_mid 720, gap null, timeline **Early / lots of runway**, program **$80 Essentials**, lead_score 4, status **COLD**.

**End-to-end:**
- Completing the flow persists exactly one `diagnostics` row with all answers + computed fields + `result_payload`.
- The on-screen result matches the persisted `result_payload`.
- Answer key is absent from the browser/client bundle (verify: search the built frontend JS for "C) 300"/correct-letters — must not appear).
- WhatsApp CTA opens the correct `wa.me` link with the name pre-filled.
- Admin behind Cloudflare Access: authed founder sees leads; an unauthenticated request to any `/api/admin/*` route returns 401/redirect.
- Editing a manual field persists across reload.
- Runs on Cloudflare free tier; handlers stay within the 10ms CPU limit.

---

## 18. Build Plan

The authoritative, incremental build plan is the **backend milestones B0-B7 in `BACKEND_SPEC.md` §6** (scaffold -> D1 -> scoring engine -> submit endpoint -> admin read -> admin update -> events/analytics -> hardening), followed by the frontend phase:

**Frontend phase (after backend B0-B7 pass), built one milestone at a time:**
- **F-M0** — Astro project in `web/`, Forge tokens/fonts, static SEO landing page (headline/subhead/benefits/Start), served by the Worker.
- **F-M1** — Diagnostic flow (React island): 22 questions, 4 sections, one-per-screen mobile, progress bar, validation, contact+consent gate. Answers assembled client-side.
- **F-M2** — Wire the flow to `POST /api/diagnostic/submit`; render the returned result payload (Score Gauge motif, all §8 blocks, WhatsApp CTA).
- **F-M3** — Admin dashboard (React island behind Cloudflare Access): leads table, filters/search, lead detail, editable manual fields, copy-WhatsApp-message, analytics view.
- **F-M4** — Polish: accessibility pass, privacy page, seed env vars (WhatsApp number + Whish link), full §17 acceptance run, deploy to production.

*(The old Next.js M0-M7 milestone list from v1 is retired; it referenced Vercel/Supabase/Tailwind and no longer applies.)*

---

## 19. Notes for the implementer
- Questions live in a typed config file (`src/lib/questions.ts`, imported by the frontend for display) — no CMS. Exact option strings must match §7 matching rules.
- Keep the scoring module pure and dependency-free so tests are trivial and logic is portable.
- Snapshot the result into `result_payload` at submit; never recompute historical leads on read.
- Prefer server-side handlers (Hono routes) over exposing any logic client-side. The answer key must never be importable from anything under `web/`.
- Build backend first (curl-testable), then frontend. Ship each milestone as its own reviewed step; do not build multiple milestones in one generation.
- Stay on Cloudflare's free tier; respect the 10ms CPU limit; never put `ANTHROPIC_API_KEY` in CI.
