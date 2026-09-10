# Forge SAT Diagnostic — Admin dashboard (F-M3) design

**Date:** 2026-09-10
**Status:** Approved by the owner; ready for an implementation plan.
**Extends** PRD §9/§10/§11/§18 and BACKEND_SPEC §1 US-3/US-4/US-5/US-7.

---

## 1. Why

The backend admin API (B4–B6) is complete and tested, but no admin UI was ever built —
PRD §18 lists F-M3 and the project went F-M2 → F-M4a → F-M4b, skipping it. Today the only
way to read a lead is `curl`. This design covers the dashboard and the small amount of
backend and instrumentation work it depends on.

### The three jobs the owner actually does

Established by interview, in priority order:

1. **"Someone just messaged me — who are they?"** The result screen ends with a WhatsApp
   CTA, so the keenest students initiate contact. The owner needs to find that student
   *fast*, from a phone, while the student waits in WhatsApp. **Lookup is time-critical.**
2. **The 2-day outbound sweep.** Every couple of days, work through everyone new who did
   *not* message first: read their result, send it, mark them done, never message twice.
3. **The weekly study session.** Find where students abandon the quiz (to fix the lead
   magnet), and find finishers who went quiet (a warm, untapped list).

### Two gaps found while designing

- **The drop-off funnel has no data source.** PRD §11 specifies five analytics events;
  only `completed` and `whatsapp_clicked` are ever fired. `start`, `advance` and
  `contact_reached` were never wired up, and `postEvent()` cannot even carry a question
  index. `GET /api/admin/analytics` is built and tested but `funnel_by_question` returns
  `[]` forever and `started` is always 0. Job 3's top priority is impossible until this
  is fixed, and drop-off data cannot be reconstructed retroactively — it must be recorded
  before launch or it is lost.
- **The leads list cannot answer jobs 1 or 2.** Search matches `first_name` only (the
  owner will have a phone number); there is no "not sent yet" filter (the entire premise
  of the sweep); and nothing links a lead to whether they tapped WhatsApp.

---

## 2. Scope

Four pieces, built in order, then deploy. The owner chose to build everything before
going live specifically so the funnel records from student number one.

| # | Piece | Milestone |
|---|-------|-----------|
| 1 | Analytics instrumentation fix | part of B8 |
| 2 | Leads-list backend additions + indexes | B8 |
| 3 | Leads dashboard (jobs 1 & 2) | F-M3a |
| 4 | Insights screen (job 3) | F-M3b |
| 5 | Deploy + Cloudflare Access lock | F-M4c |

### Non-goals

- No auto-sending of anything. The owner always presses send themselves (PRD §16).
- No multi-admin, no roles, no record deletion from the UI (PRD §16).
- No editing of computed fields or answers — the PATCH whitelist stays exactly as it is.
- No new dependencies. React 18 + Astro islands + plain CSS, as the rest of `web/` does.
- No charting library. The funnel is CSS bars; it does not justify a dependency on a
  10ms-CPU, free-tier project.

---

## 3. Piece 1 — Analytics instrumentation

**Files:** `web/src/lib/api.ts`, `web/src/components/DiagnosticFlow.tsx`

`postEvent(sessionId, type)` gains an optional third argument:

```ts
export function postEvent(sessionId: string, type: EventType, questionIndex?: number): void
```

When present it is sent as `question_index`. The existing contract is unchanged:
fire-and-forget, `keepalive: true`, never throws into the render path, silent on failure.
`eventSchema` already accepts `question_index` as a non-negative integer, so **no backend
change is required** for this piece.

`DiagnosticFlow` fires the three missing events:

| Event | When | `question_index` |
|-------|------|------------------|
| `start` | once, on first mount | — |
| `advance` | the first time each question screen is shown | the question's 1-based number `n` from `QUESTIONS` (1–17) |
| `contact_reached` | once, when the contact screen is shown | — |

**There are 18 screens, not 22.** `DiagnosticFlow` derives its screens as
`CHOICE_QUESTIONS = QUESTIONS.filter(q => q.section !== 4)` — the 17 one-per-screen
questions of sections 1–3 (Q1–Q4 context, Q5–Q12 scored skills, Q13–Q17 habits) — and then
renders **all of section 4 (Q18–Q22: name, WhatsApp, school, respondent type, consent) on a
single final contact screen**.

So `advance` covers Q1–Q17 only, and `contact_reached` *is* the contact-gate signal — there
is no per-question advance inside section 4 because there are no separate screens there.
The funnel is therefore **17 question bars + one contact-gate bar + completed**, which still
answers the owner's question exactly: it distinguishes quitting on the quiz from quitting
when asked for a phone number.

**`question_index` is defined as the 1-based question number** (`QUESTIONS[i].n`, i.e. 1–22),
not an array offset. This makes the funnel directly legible ("Q8") and lets the insights
screen join to question text by `n`. No data exists yet, so there is no migration concern.

Each event fires **at most once per session**: `start` and `contact_reached` guard with a
ref (React 18 StrictMode double-mounts in dev); `advance` keeps a `Set` of numbers already
sent, so back-navigation does not double count. The backend counts distinct sessions
anyway, so duplicates would be harmless — this keeps the events table small.

Analytics must never affect the student. No `await`, no error surfaced, no state change
on failure.

---

## 4. Piece 2 — Backend additions (B8)

**Files:** `src/routes/admin.ts`, a new migration, `test/`.

### 4.1 `GET /api/admin/leads` — search by phone as well as name

`q` currently matches `first_name` only. It becomes: match `first_name` **OR** the
phone number.

`whatsapp` is stored as free text (`z.string().trim().min(1)`) — students type
`+961 70 123 456`, `03 123 456`, `70123456`. So the phone comparison normalises **both
sides** to digits: the query is stripped to digits in JS, and the column is stripped in
SQL with a nested `replace()` chain (spaces, `-`, `+`, `(`, `)`, `.`).

The phone clause is only added when the stripped query has **≥ 3 digits**, so searching
`"Li"` does not accidentally match phone numbers.

Trade-off, accepted: the `replace()` expression is not indexable, so phone search is a
scan. At this project's scale (a few thousand leads at most) that is far cheaper than
denormalising a second column and backfilling it.

### 4.2 `GET /api/admin/leads` — new filters

| Param | Values | Meaning |
|-------|--------|---------|
| `result_sent` | `0` \| `1` | Job 2's sweep queue: everyone not yet sent their result. |
| `engaged` | `0` \| `1` | Whether a `whatsapp_clicked` event exists for this lead's session. |

Both follow the existing failure convention exactly: an unrecognised value returns
`400 { error: 'invalid_filter', field, allowed }`, consistent with `status`/`program`.

### 4.3 `GET /api/admin/leads` — new response column

Every row in `leads[]` gains `whatsapp_clicked: 0 | 1`, resolved with a correlated
subquery in the existing paged SELECT:

```sql
EXISTS (SELECT 1 FROM events e
        WHERE e.session_id = diagnostics.session_id
          AND e.type = 'whatsapp_clicked')
```

This keeps the handler at **one COUNT + one paged SELECT** — no N+1, per CLAUDE.md.
`diagnostics.session_id` is already UNIQUE and the new index below makes the subquery a
point lookup.

### 4.4 `GET /api/admin/analytics` — audience mix

Two additional aggregates for job 3's low-priority "who the quiz is attracting":

- `archetype_mix`: `GROUP BY archetype`
- `program_mix`: `GROUP BY recommended_program`

Both are plain COUNT/GROUP BY, matching the endpoint's existing F7.2 constraint. This
takes the endpoint from four aggregate queries to six; all are I/O-bound, not CPU-bound.

### 4.5 New migration — indexes

```sql
CREATE INDEX idx_events_session_type    ON events(session_id, type);
CREATE INDEX idx_events_type_question   ON events(type, question_index);
CREATE INDEX idx_diagnostics_created_at ON diagnostics(created_at);
```

The first makes §4.3's subquery and the `engaged` filter point lookups; the second serves
the funnel's `GROUP BY question_index`; the third serves the list's
`ORDER BY created_at DESC` paging. Generated via `npm run db:generate`, applied locally
and (at deploy) remotely.

---

## 5. Piece 3 — Leads dashboard (F-M3a)

### 5.1 Files

```
web/src/pages/admin.astro                    shell: tokens, fonts, noindex, mounts the island
web/src/lib/adminApi.ts                      typed fetch helpers + response types
web/src/components/AdminDashboard.tsx        root island: tab + search + selection state
web/src/components/admin/LeadsList.tsx       the queue (table >=900px, cards below)
web/src/components/admin/LeadDetail.tsx      one lead: message, actions, manual fields
web/src/components/admin/Insights.tsx        piece 4
web/src/components/admin.css                 all admin styling
```

`admin.astro` mirrors `diagnostic.astro`: the same Forge tokens, the same self-hosted
fonts, `<meta name="robots" content="noindex,nofollow">`, and `<AdminDashboard client:load />`.

Components stay small and single-purpose. `LeadsList` renders rows and raises selection;
it does not fetch. `LeadDetail` owns one lead's fetch and its saves. `AdminDashboard`
owns navigation state and the list query. This keeps each file reviewable and testable
on its own.

### 5.2 Layout

A persistent header: the title and a **search box that is always visible** (job 1),
matching name *or* phone, debounced ~250ms.

Three tabs:

| Tab | Query | Purpose |
|-----|-------|---------|
| **To send** (default) | `result_sent=0` | Job 2's sweep queue, with a count badge |
| **All leads** | none + status/program/date filters | Everything, for lookup and browsing |
| **Insights** | analytics | Job 3 |

**Row/card content:** first name · relative time · HOT/WARM/COLD pill (red/amber/grey per
PRD §9) · `whatsapp_clicked` indicator ("tapped you") · estimated band · gap · archetype ·
result-sent state.

**Responsive:** a table at >=900px, one card per lead below that. Same data, same order —
a CSS concern, not two component trees.

### 5.3 Lead detail

Opening a lead fetches `GET /api/admin/leads/:id` (one indexed lookup) and shows, in
priority order:

1. **Identity** — name, status pill, lead score, respondent type, grade, school, phone.
2. **The action block** — the server-assembled `whatsapp_message` shown in full, then:
   - **Open WhatsApp** — `https://wa.me/{digits}?text={encodeURIComponent(message)}`.
     The button label includes the destination number so the owner can see who it will
     open before tapping. If the number yields no digits the button is disabled rather
     than rendering a broken link — the same rule as F2.1 on the result screen.
   - **Mark sent** — `PATCH { result_sent: true }`.
   - **Next lead** — advances through the current queue without returning to the list,
     which is what makes the sweep fast.
3. **Manual fields** — `followup_status` and `outcome` as selects, `notes` as a textarea.
   **Auto-saved:** selects PATCH on change, notes debounce ~600ms. A quiet
   "Saving… / Saved" indicator; on failure, an inline error and the typed value is kept.
   Last-write-wins is already the documented backend behaviour (F5.5) and this is a
   single-admin tool.
4. **Full result** and **all 22 answers** — collapsed by default so the sweep stays
   scannable and the weekly deep-read can expand them.

### 5.4 States

Every view needs an explicit empty, loading, and error state. In particular:

- **401** — "Your Access session expired. Reload the page." (Access sessions expire; this
  must not look like a bug.)
- **Empty "To send"** — "You're all caught up" rather than a blank table.
- **No search results** — distinguish "no leads yet" from "nothing matched that search".

---

## 6. Piece 4 — Insights screen (F-M3b)

Three blocks, in the owner's stated priority order.

### 6.1 Where students quit (primary)

A horizontal bar per screen — **Q1–Q17, then the contact gate, then completed** — each
labelled with its **real question text** from `src/lib/questions.ts` (browser-safe; contains
no answer key), joined on the 1-based `n` defined in §3. Each row shows how many distinct
sessions reached that screen and how many were lost between it and the previous one. The
three biggest losses are highlighted.

The contact-gate bar is fed by `contact_reached` and the final bar by `completed`, so the
funnel runs unbroken from "started the quiz" to "saw their result".

Because `advance` fires on *reaching* a question, "lost at Q8" means reached Q8 and never
reached Q9 — this must be stated on screen so the numbers are not misread.

The bars are grouped by section so the shape of the flow is visible at a glance, and the
**contact gate is marked distinctly** — it is the point where an anonymous quiz-taker is
asked for their name and number. Drop-off there is a different problem from drop-off on a
hard maths question, and the screen should not let the two be confused.

### 6.2 Finished but went quiet (primary)

`listLeads({ engaged: 0 })` — everyone who completed the diagnostic and never tapped the
WhatsApp button, newest first, showing whether their result was sent. This is the warm,
untapped list, and unlike the anonymous funnel these are real people with real numbers.

Honest caveat shown in the UI: tapping the button is a proxy for starting a chat, not
proof of one. `followup_status = 'Replied'`, which the owner sets by hand, is the
authoritative signal.

### 6.3 Who the quiz is attracting (brief)

A compact strip: HOT/WARM/COLD mix, archetype counts, programme split, plus the headline
rates (completion, WhatsApp click, enrolment). Explicitly low priority — kept small.

### 6.4 Empty states carry the weight

This ships **before any traffic exists**, so on day one every block will be empty. Each
must explain what will appear and what triggers it — e.g. "No drop-off data yet. This
fills in as students work through the quiz." A blank chart would read as a broken feature.

---

## 7. Security model

**How `/admin` is protected.** Astro builds `output: 'static'`, so `/admin/index.html` is
a static asset served by Cloudflare's asset layer — **the Worker's `requireAdmin()` never
runs for it**. Cloudflare Access is what gates the page itself.

That is sufficient, by design:

- The `/admin` shell contains **no student data**. It is an empty frame.
- Every byte of data arrives from `/api/admin/*`, which is gated **twice**: Cloudflare
  Access at the edge, and independent JWT verification (signature, audience, issuer,
  expiry, and the founder's email) inside the Worker via `src/lib/access.ts`.
- Worst case — someone loads the HTML — they see an empty page and every request 401s.

**Considered and rejected:** routing `/admin` through the Worker (`run_worker_first`) to
add Worker-side gating on the HTML. It adds asset-serving complexity to protect a shell
that holds nothing.

**Answer-key rule reaffirmed:** nothing under `web/` may import `src/lib/answerKey.ts`.
The admin bundle imports only `src/lib/questions.ts`, which is explicitly browser-safe and
contains question text and options but no correct answers.

The dev bypass is unaffected: it remains double-gated by `DEV_ADMIN_SECRET` (never
deployed) and force-disabled whenever `ACCESS_AUD` is set.

---

## 8. Testing

**Backend** (Vitest + `@cloudflare/vitest-pool-workers`, extending `test/`):

- phone search matches across stored formats (`+961 70 …`, `03-123-456`, `70123456`);
- a short/alphabetic `q` does *not* trigger phone matching;
- `result_sent=0|1` and `engaged=0|1` filter correctly; bad values → `400 invalid_filter`;
- `whatsapp_clicked` is `1` only when such an event exists for that lead's session;
- `archetype_mix` / `program_mix` totals match the row counts;
- every new parameter is still `401` when unauthenticated.

**Frontend** (Vitest + jsdom + Testing Library, in `web/test/`):

- `postEvent` sends `question_index` when given and omits it otherwise;
- `DiagnosticFlow` fires `start` once, `contact_reached` once, and `advance` once per
  question with the correct 1-based number, including under StrictMode double-mount;
- the wa.me link is correctly encoded and is **never** rendered when the number has no
  digits (guarding the `wa.me/undefined` class of bug already fixed on the result screen);
- auto-save PATCHes only whitelisted fields;
- the "To send" tab requests `result_sent=0`;
- funnel rows map to the right question text;
- empty and 401 states render.

Existing gates stay green: `npm run typecheck`, `npm test`, `npm --prefix web test`,
`npm run build`.

---

## 9. Sequencing

1. **B8** — instrumentation fix, list additions, analytics mix, index migration, tests.
2. **F-M3a** — leads dashboard.
3. **F-M3b** — insights screen.
4. **F-M4c** — deploy, create the Cloudflare Access application over `/admin` and
   `/api/admin`, set `ADMIN_EMAIL` / `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`, redeploy, and
   prove the lock three ways (owner gets in; unauthenticated `/api/admin/*` rejected; the
   dev bypass provably dead in production).

Each stops for owner confirmation, per CLAUDE.md.
