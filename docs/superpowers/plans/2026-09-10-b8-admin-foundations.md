# B8 — Admin foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the analytics instrumentation so the drop-off funnel has a data source, and add the three leads-list capabilities the admin dashboard needs, so F-M3a can be built on a complete API.

**Architecture:** Two independent halves. The browser half teaches `postEvent` to carry a question number and makes `DiagnosticFlow` fire the three missing PRD §11 events. The Worker half extends `GET /api/admin/leads` with phone search, a `result_sent` filter, an `engaged` filter and a `whatsapp_clicked` column, and adds two GROUP BY aggregates to `GET /api/admin/analytics`. A migration adds three indexes. No schema columns change, no new dependencies, no change to the submit path.

**Tech Stack:** Cloudflare Workers · Hono · D1 · Drizzle ORM · Wrangler · Vitest (`@cloudflare/vitest-pool-workers` for the Worker, jsdom + Testing Library for `web/`) · Astro + React 18 islands.

**Spec:** [`docs/superpowers/specs/2026-09-10-forge-admin-dashboard-design.md`](../specs/2026-09-10-forge-admin-dashboard-design.md)

## Global Constraints

These apply to every task. Copied verbatim from CLAUDE.md and the spec.

- **Stack is locked — do not substitute.** Cloudflare Workers · Hono · D1 (SQLite) · Drizzle ORM · Wrangler · Vitest. Frontend Astro + React islands.
- **Add zero new dependencies.** Neither `package.json` may gain a dependency in this milestone.
- **Must stay on Cloudflare's free tier and be commercial-legal. No paid services.**
- **10ms CPU per request:** lean handlers, no N+1 D1 queries, no heavy work in hot paths. `GET /api/admin/leads` must remain **one COUNT + one paged SELECT**.
- **The answer key lives ONLY server-side in `src/lib/answerKey.ts`.** Never ship it to the browser; never import anything under `web/` from it. From `web/`, the only permitted import out of the server tree is `src/lib/questions.ts`.
- **Never** put `ANTHROPIC_API_KEY` in any CI workflow.
- **Result + lead must persist atomically** (US-1.5/1.8) — this milestone must not touch `POST /api/diagnostic/submit`.
- **Contract-first:** routes not yet in their milestone return `501` with the intended shape documented as a comment.
- **Analytics must never affect the student.** Beacons are fire-and-forget: no `await`, no thrown error, no state change on failure.
- **Failure convention for list filters:** an unrecognised value returns `400 { error: 'invalid_filter', field, allowed }`, matching the existing `status` / `program` handling.
- **`question_index` means the 1-based question number `n` from `QUESTIONS`** (1–17 for the question screens), never an array offset.
- Commit after every task. Windows/PowerShell: use `curl.exe` and `NUL` in any manual verification.

## Facts an implementer needs (verified against the code)

- `DiagnosticFlow` renders **18 screens, not 22**: `CHOICE_QUESTIONS = QUESTIONS.filter(q => q.section !== 4)` gives the 17 one-per-screen questions (Q1–Q17), and all of section 4 (Q18–Q22) renders together on one final contact screen. The UI reads "Question N of 17".
- `step` is 0-based over `CHOICE_QUESTIONS`; `onContactScreen === (step === CHOICE_QUESTIONS.length)`.
- The session id is `sessionId.current`, a `useRef<string>(crypto.randomUUID())`.
- `web/` imports the question config as `'../../../src/lib/questions'` (from `web/src/components/`).
- Worker tests get env from `vitest.config.mts` `miniflare.bindings`, **not** from `.dev.vars`. Admin auth in tests is the dev bypass: headers `X-Dev-Access-Email: founder@example.com` and `X-Dev-Access-Secret: local-dev-secret-change-me`.
- `test/seed.ts` exports `makeLead(overrides)` which builds a complete `diagnostics` row from the RAMI fixture.
- `test/analytics.test.ts` has a local `ev(session_id, type, question_index?)` helper for building event rows.
- Insert leads **one row per insert** — a lead has 44 columns and D1 caps bound parameters per statement.

---

### Task 1: Answer-key boundary guard test

Establishes the safety net before anything else changes. Nothing under `web/` may import the answer key, and the only server module `web/` may import is `questions.ts`. Today this is enforced by discipline alone; F-M3a will add a second browser bundle that imports across the same boundary, so the guard goes in first.

**Files:**
- Create: `web/test/answer-key-boundary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. A failing build if the boundary is ever crossed.

- [ ] **Step 1: Write the failing test**

Create `web/test/answer-key-boundary.test.ts`:

```ts
/**
 * Guards the project's single most important security rule (CLAUDE.md): the scoring
 * answer key is server-only and must never reach a student's browser.
 *
 * Enforced two ways: nothing under web/src may import `answerKey`, and the ONLY module
 * web/src may import out of the server tree (src/lib) is `questions.ts`, which is
 * deliberately browser-safe. Any new cross-boundary import fails the build until it is
 * added to ALLOWED_SERVER_IMPORTS with a deliberate decision.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Modules under src/lib that web/ is allowed to import. questions.ts holds no answers. */
const ALLOWED_SERVER_IMPORTS = ['questions'];

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(ts|tsx|astro)$/.test(entry)) out.push(p);
	}
	return out;
}

/** Every import/re-export/dynamic-import specifier in a file. */
function importsOf(file: string): string[] {
	const src = readFileSync(file, 'utf8');
	return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const files = walk(WEB_SRC);

describe('the answer key never reaches the browser bundle', () => {
	it('actually found source files to check', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no file under web/src imports the answer key', () => {
		const offenders = files
			.filter((f) => importsOf(f).some((s) => s.toLowerCase().includes('answerkey')))
			.map((f) => f.replace(WEB_SRC, 'web/src/'));
		expect(offenders).toEqual([]);
	});

	it('only questions.ts may be imported from the server tree', () => {
		const offenders: string[] = [];
		for (const f of files) {
			for (const spec of importsOf(f)) {
				const m = spec.match(/(?:^|\/)src\/lib\/([A-Za-z0-9_.-]+?)(?:\.[tj]sx?)?$/);
				if (m && !ALLOWED_SERVER_IMPORTS.includes(m[1])) {
					offenders.push(`${f.replace(WEB_SRC, 'web/src/')} imports ${spec}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
```

- [ ] **Step 2: Run it and confirm it passes on today's clean tree**

Run: `npm --prefix web test -- answer-key-boundary`
Expected: 3 tests PASS. (This guard describes a rule already being followed — it passes now and fails the day someone breaks it.)

- [ ] **Step 3: Prove the guard actually bites**

Temporarily add this line to the top of `web/src/lib/api.ts`:

```ts
import { ANSWER_KEY } from '../../../src/lib/answerKey';
```

Run: `npm --prefix web test -- answer-key-boundary`
Expected: **FAIL** on both "no file under web/src imports the answer key" and "only questions.ts may be imported from the server tree".

- [ ] **Step 4: Remove the temporary line and re-run**

Delete the import you just added to `web/src/lib/api.ts`.

Run: `npm --prefix web test -- answer-key-boundary`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/test/answer-key-boundary.test.ts
git commit -m "test(web): guard the answer-key boundary

Nothing under web/src may import answerKey.ts, and questions.ts is the
only server module web/ may import. Verified to fail when the boundary
is deliberately crossed."
```

---

### Task 2: Index migration

Three indexes so the new list query and the funnel stay cheap under the 10ms CPU rule. Defined in the Drizzle schema (the source of truth) and generated, never hand-written.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `migrations/000N_*.sql` (generated — do not author by hand)

**Interfaces:**
- Consumes: nothing.
- Produces: indexes `idx_events_session_type`, `idx_events_type_question`, `idx_diagnostics_created_at`, relied on by Tasks 5–7.

- [ ] **Step 1: Add the `index` import to the schema**

In `src/db/schema.ts`, change the drizzle import line to include `index`:

```ts
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
```

- [ ] **Step 2: Add the index callback to `diagnostics`**

`sqliteTable` takes an optional third argument: a callback returning an array of table extras. The `diagnostics` call currently ends with `});` after the `notes` column. Change that closing to add the callback:

```ts
	notes: text('notes'), // nullable
}, (t) => [
	// The list endpoint always pages newest-first (B8).
	index('idx_diagnostics_created_at').on(t.created_at),
]);
```

- [ ] **Step 3: Add the index callback to `events`**

The `events` call currently ends with `});` after the `meta` column. Change that closing to:

```ts
	meta: text('meta'), // nullable JSON string
}, (t) => [
	// B8: makes the leads list's `whatsapp_clicked` EXISTS subquery a point lookup.
	index('idx_events_session_type').on(t.session_id, t.type),
	// B8: serves the analytics funnel's GROUP BY question_index.
	index('idx_events_type_question').on(t.type, t.question_index),
]);
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `migrations/000N_<name>.sql` containing three `CREATE INDEX` statements and nothing else. Open it and confirm — if it contains any `ALTER TABLE` or `DROP`, stop: the schema was edited beyond indexes.

- [ ] **Step 5: Apply locally and verify**

Run: `npm run db:migrate:local`

Then verify the indexes exist:

```bash
npx wrangler d1 execute forge_diagnostic --local --command "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;"
```

Expected: `idx_diagnostics_created_at`, `idx_events_session_type`, `idx_events_type_question`.

- [ ] **Step 6: Run the full Worker suite**

Run: `npm test`
Expected: all tests pass. (`vitest.config.mts` reads `./migrations` and applies them to the test database, so the new migration is exercised automatically.)

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts migrations/
git commit -m "perf(db): index events(session_id,type), events(type,question_index), diagnostics(created_at)

Keeps B8's leads-list EXISTS subquery and the analytics funnel's GROUP BY
as index lookups, preserving the one-COUNT-one-SELECT rule under the 10ms
CPU budget. Indexes only — no column changes."
```

---

### Task 3: `postEvent` carries a question number

**Files:**
- Modify: `web/src/lib/api.ts:62-75`
- Modify: `web/test/setup.ts`
- Test: `web/test/post-event.test.ts` (create)

**Interfaces:**
- Consumes: `EventType` from `web/src/lib/api.ts`.
- Produces: `postEvent(sessionId: string, type: EventType, questionIndex?: number): void` — used by Task 4.

- [ ] **Step 1: Stub `fetch` globally in the web test setup**

Task 4 makes `DiagnosticFlow` fire beacons on mount, which every existing flow test would otherwise send at a real network. Add a default stub to `web/test/setup.ts`, before the `afterEach`:

```ts
// Analytics beacons fire on mount (PRD §11). Give jsdom a no-op fetch so flow tests never
// touch the network; individual tests override it with vi.stubGlobal when they assert on it.
if (!globalThis.fetch) {
	globalThis.fetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;
}
```

- [ ] **Step 2: Write the failing test**

Create `web/test/post-event.test.ts`:

```ts
/**
 * postEvent is the analytics beacon (PRD §11). Two rules it must never break:
 * it carries question_index only when given one, and it never throws into the
 * render path — a student's flow must not depend on analytics succeeding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postEvent } from '../src/lib/api';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function bodyOfCall(i: number): unknown {
	const init = fetchMock.mock.calls[i][1] as RequestInit;
	return JSON.parse(init.body as string);
}

describe('postEvent', () => {
	it('omits question_index when none is given', () => {
		postEvent('sess-1', 'start');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/event');
		expect(bodyOfCall(0)).toEqual({ session_id: 'sess-1', type: 'start' });
	});

	it('sends question_index when given one', () => {
		postEvent('sess-1', 'advance', 5);
		expect(bodyOfCall(0)).toEqual({ session_id: 'sess-1', type: 'advance', question_index: 5 });
	});

	it('sends question_index 0 rather than dropping it', () => {
		postEvent('sess-1', 'advance', 0);
		expect(bodyOfCall(0)).toEqual({ session_id: 'sess-1', type: 'advance', question_index: 0 });
	});

	it('keeps keepalive so the beacon survives navigation', () => {
		postEvent('sess-1', 'whatsapp_clicked');
		expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
	});

	it('never throws when fetch rejects', async () => {
		fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
		expect(() => postEvent('sess-1', 'completed')).not.toThrow();
		await Promise.resolve();
	});

	it('never throws when fetch is missing entirely', () => {
		vi.stubGlobal('fetch', undefined);
		expect(() => postEvent('sess-1', 'completed')).not.toThrow();
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm --prefix web test -- post-event`
Expected: FAIL — "sends question_index when given one" fails because the current body is `{ session_id, type }` with no `question_index`.

- [ ] **Step 4: Write the implementation**

Replace the body of `postEvent` in `web/src/lib/api.ts` (keep the existing doc comment above it, and extend it):

```ts
export function postEvent(sessionId: string, type: EventType, questionIndex?: number): void {
	try {
		const body: { session_id: string; type: EventType; question_index?: number } = {
			session_id: sessionId,
			type,
		};
		// Only 'advance' carries a question number; the server's eventSchema treats it as optional.
		if (typeof questionIndex === 'number') body.question_index = questionIndex;
		void fetch('/api/event', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			keepalive: true,
		}).catch(() => {
			/* analytics failures are silent to the student */
		});
	} catch {
		/* never let a beacon throw into the render path */
	}
}
```

Also extend the doc comment above it with one line:

```
 * `questionIndex` is the 1-based question number (PRD §11 funnel), sent only for 'advance'.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --prefix web test -- post-event`
Expected: 6 tests PASS.

- [ ] **Step 6: Run the whole web suite and typecheck**

Run: `npm --prefix web test`
Expected: all files pass.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/api.ts web/test/post-event.test.ts web/test/setup.ts
git commit -m "feat(web): let postEvent carry question_index

PRD §11's drop-off funnel needs a question number on 'advance' events;
the beacon helper could not carry one. Optional third argument, omitted
from the body when absent. Fire-and-forget contract unchanged."
```

---

### Task 4: `DiagnosticFlow` fires start, advance and contact_reached

The milestone's whole point: without this the funnel has no data source, and drop-off cannot be reconstructed after the fact.

**Files:**
- Modify: `web/src/components/DiagnosticFlow.tsx` (import list ~line 26; new effect after the countdown effect ~line 135)
- Test: `web/test/flow-analytics.test.tsx` (create)

**Interfaces:**
- Consumes: `postEvent(sessionId, type, questionIndex?)` from Task 3.
- Produces: `start` once per session, `advance` once per question screen carrying `q.n` (1–17), `contact_reached` once when the contact screen appears.

- [ ] **Step 1: Write the failing test**

Create `web/test/flow-analytics.test.tsx`:

```tsx
/**
 * PRD §11 requires five analytics events. Only 'completed' and 'whatsapp_clicked' were
 * ever wired up, so the admin drop-off funnel had no data source at all. These tests lock
 * the three missing ones in place.
 *
 * The flow renders 18 screens: the 17 one-per-screen questions of sections 1–3, then a
 * single contact screen holding all of section 4 (Q18–Q22). So 'advance' fires 17 times
 * (carrying the 1-based question number) and 'contact_reached' marks the contact gate.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import DiagnosticFlow from '../src/components/DiagnosticFlow';

const ADVANCE_MS = 160;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(() => Promise.resolve(new Response('{}')));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Every beacon posted to /api/event so far, in order. */
function beacons(): Array<{ session_id: string; type: string; question_index?: number }> {
	return fetchMock.mock.calls
		.filter((c) => c[0] === '/api/event')
		.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

function firstOption(container: HTMLElement): HTMLElement {
	const btn = container.querySelector('.fd-options button');
	if (!btn) throw new Error('no answer option rendered on the current screen');
	return btn as HTMLElement;
}

function answerCurrent(container: HTMLElement) {
	fireEvent.click(firstOption(container));
	act(() => {
		vi.advanceTimersByTime(ADVANCE_MS);
	});
}

test('fires start once and advance for Q1 on mount', () => {
	vi.useFakeTimers();
	try {
		render(<DiagnosticFlow />);
		const sent = beacons();
		expect(sent.filter((b) => b.type === 'start')).toHaveLength(1);
		expect(sent.filter((b) => b.type === 'advance')).toEqual([
			{ session_id: expect.any(String), type: 'advance', question_index: 1 },
		]);
	} finally {
		vi.useRealTimers();
	}
});

test('every beacon carries the same session id', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);
		answerCurrent(container);
		const ids = new Set(beacons().map((b) => b.session_id));
		expect(ids.size).toBe(1);
	} finally {
		vi.useRealTimers();
	}
});

test('advance fires once per question with its 1-based number, then contact_reached', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);
		for (let n = 1; n <= 17; n++) {
			expect(screen.getByText(`Question ${n} of 17`)).toBeTruthy();
			answerCurrent(container);
		}
		expect(screen.getByText('Where should we send your results?')).toBeTruthy();

		const sent = beacons();
		expect(sent.filter((b) => b.type === 'advance').map((b) => b.question_index)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
		]);
		expect(sent.filter((b) => b.type === 'contact_reached')).toHaveLength(1);
		expect(sent.filter((b) => b.type === 'start')).toHaveLength(1);
	} finally {
		vi.useRealTimers();
	}
});

test('going back and forward does not double-count a question', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);
		answerCurrent(container); // now on Q2
		expect(screen.getByText('Question 2 of 17')).toBeTruthy();

		fireEvent.click(screen.getByText('Back'));
		expect(screen.getByText('Question 1 of 17')).toBeTruthy();
		answerCurrent(container); // forward to Q2 again

		const advances = beacons()
			.filter((b) => b.type === 'advance')
			.map((b) => b.question_index);
		expect(advances).toEqual([1, 2]);
	} finally {
		vi.useRealTimers();
	}
});

test('a failing beacon never breaks the flow', () => {
	vi.useFakeTimers();
	try {
		fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
		const { container } = render(<DiagnosticFlow />);
		expect(screen.getByText('Question 1 of 17')).toBeTruthy();
		answerCurrent(container);
		expect(screen.getByText('Question 2 of 17')).toBeTruthy();
	} finally {
		vi.useRealTimers();
	}
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web test -- flow-analytics`
Expected: FAIL — the first test fails because no beacons are sent at all on mount.

If the "Back" test fails on the button label, run `npm --prefix web test -- flow-analytics 2>&1 | head -40` and read the rendered output to find the real label, then fix the test's `getByText` to match. Do not change the component to suit the test.

- [ ] **Step 3: Import `postEvent` in the component**

In `web/src/components/DiagnosticFlow.tsx`, change the existing api import to include `postEvent`:

```ts
import { postEvent, submitDiagnostic, type ResultPayload } from '../lib/api';
```

- [ ] **Step 4: Add the analytics effect**

In `web/src/components/DiagnosticFlow.tsx`, immediately **after** the countdown `useEffect` (the one that ends `}, [step]);`) and before `handleTimeout`, add:

```tsx
	// ── Analytics (PRD §11) ───────────────────────────────────────────────────────
	// The funnel needs to know how far each session got. One 'start' per session, one
	// 'advance' per question screen carrying its 1-based number n (1–17), and one
	// 'contact_reached' when the section-4 contact screen appears — that last one is the
	// contact gate, the point where an anonymous quiz-taker is asked for their number.
	// Refs (not state) because React 18 StrictMode double-mounts in dev and back-navigation
	// re-runs this effect; each event must fire at most once per session.
	const startedRef = useRef(false);
	const advancedRef = useRef<Set<number>>(new Set());
	const contactReachedRef = useRef(false);

	useEffect(() => {
		if (!startedRef.current) {
			startedRef.current = true;
			postEvent(sessionId.current, 'start');
		}
		if (onContactScreen) {
			if (!contactReachedRef.current) {
				contactReachedRef.current = true;
				postEvent(sessionId.current, 'contact_reached');
			}
			return;
		}
		const q = CHOICE_QUESTIONS[step];
		if (q && !advancedRef.current.has(q.n)) {
			advancedRef.current.add(q.n);
			postEvent(sessionId.current, 'advance', q.n);
		}
	}, [step, onContactScreen]);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --prefix web test -- flow-analytics`
Expected: 5 tests PASS.

- [ ] **Step 6: Run the whole web suite — the existing flow tests must still pass**

Run: `npm --prefix web test`
Expected: all files pass, including `fast-tap.test.tsx`. If a fast-tap test now fails, the analytics effect has changed navigation timing — that is a real regression, fix the effect, never the fast-tap test.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/DiagnosticFlow.tsx web/test/flow-analytics.test.tsx
git commit -m "feat(web): fire the three missing PRD §11 analytics events

start, advance (with the 1-based question number) and contact_reached
were specified but never wired up, so GET /api/admin/analytics returned
an empty funnel and started=0 forever. Drop-off cannot be reconstructed
retroactively, so this must land before any traffic arrives.

Each event fires at most once per session via refs, so StrictMode
double-mounts and back-navigation never double-count."
```

---

### Task 5: Leads list — search by phone number as well as name

The owner's most time-critical job: a student messages them on WhatsApp, and they have a phone number, not a name.

**Files:**
- Modify: `src/routes/admin.ts` (the `q.q` block, ~line 100)
- Test: `test/admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/admin/leads?q=` matching `first_name` OR the normalised `whatsapp` number.

- [ ] **Step 1: Write the failing test**

Append to `test/admin.test.ts`:

```ts
describe('GET /api/admin/leads — search by phone as well as name (B8)', () => {
	// Students type their number however they like; search must find them regardless.
	const NUMBERS = [
		{ first_name: 'Spaced', whatsapp: '+961 70 123 456' },
		{ first_name: 'Dashed', whatsapp: '03-123-456' },
		{ first_name: 'Bare', whatsapp: '70999888' },
		{ first_name: 'Parens', whatsapp: '(961) 70.111.222' },
	];

	async function names(query: string): Promise<string[]> {
		const res = await SELF.fetch(`https://x/api/admin/leads?q=${encodeURIComponent(query)}`, { headers: auth });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { leads: Array<{ first_name: string }> };
		return body.leads.map((l) => l.first_name).sort();
	}

	it('finds a lead by digits regardless of how the number was typed', async () => {
		await seed(NUMBERS);
		expect(await names('70123456')).toEqual(['Spaced']);
		expect(await names('03123456')).toEqual(['Dashed']);
		expect(await names('70999888')).toEqual(['Bare']);
		expect(await names('70111222')).toEqual(['Parens']);
	});

	it('finds a lead by a partial number', async () => {
		await seed(NUMBERS);
		expect(await names('123456')).toEqual(['Dashed', 'Spaced']);
	});

	it('still finds a lead by name', async () => {
		await seed([{ first_name: 'Lina', whatsapp: '+961 70 555 000' }, { first_name: 'Karim', whatsapp: '+961 71 555 111' }]);
		expect(await names('Lin')).toEqual(['Lina']);
	});

	it('a short or alphabetic query does not trigger phone matching', async () => {
		// '12' has only two digits — must not scan phone numbers, or every lead matches.
		await seed([{ first_name: 'Ada', whatsapp: '+961 70 121 212' }]);
		expect(await names('12')).toEqual([]);
	});

	it('an empty result is still 200 with an empty list', async () => {
		await seed(NUMBERS);
		expect(await names('99999999')).toEqual([]);
	});

	it('is still 401 without credentials', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads?q=70123456');
		expect(res.status).toBe(401);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- admin`
Expected: FAIL — "finds a lead by digits" returns `[]`, because `q` currently only matches `first_name`.

- [ ] **Step 3: Write the implementation**

In `src/routes/admin.ts`, add `or` and `sql` to the drizzle import:

```ts
import { and, count, countDistinct, desc, eq, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
```

Then, above the `admin.get('/leads', ...)` handler, add the normaliser:

```ts
/**
 * The stored `whatsapp` is free text — students type "+961 70 123 456", "03-123-456",
 * "70123456". Strip the punctuation in SQL so a digits-only query matches any format.
 * Not indexable, so this is a scan; acceptable at this scale and only ever run when the
 * search query actually contains digits.
 */
const WHATSAPP_DIGITS = sql`replace(replace(replace(replace(replace(replace(${diagnostics.whatsapp}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')`;
```

Then replace the existing `q.q` block:

```ts
	if (q.q !== undefined && q.q.trim() !== '') {
		conds.push(like(diagnostics.first_name, `%${q.q.trim()}%`));
	}
```

with:

```ts
	if (q.q !== undefined && q.q.trim() !== '') {
		const term = q.q.trim();
		const nameMatch = like(diagnostics.first_name, `%${term}%`);
		// Only search numbers when the query really looks like one: 1–2 digits would
		// match almost every lead and make the search useless.
		const digits = term.replace(/\D/g, '');
		if (digits.length >= 3) {
			conds.push(or(nameMatch, sql`${WHATSAPP_DIGITS} LIKE ${`%${digits}%`}`) as SQL);
		} else {
			conds.push(nameMatch);
		}
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- admin`
Expected: all `admin.test.ts` tests PASS, including the six new ones.

- [ ] **Step 5: Run the whole Worker suite and typecheck**

Run: `npm test`
Expected: all pass.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.ts test/admin.test.ts
git commit -m "feat(admin): search leads by phone number as well as name

When a student messages first, the founder has their number, not their
name. Both sides are normalised to digits so any stored format matches;
the phone clause only engages at 3+ digits so short queries stay a name
search."
```

---

### Task 6: Leads list — `result_sent` and `engaged` filters, `whatsapp_clicked` column

Powers the 2-day sweep queue ("everyone I haven't sent yet") and the "finished but went quiet" list.

**Files:**
- Modify: `src/routes/admin.ts` (`LIST_COLUMNS`, the filter block)
- Test: `test/admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `idx_events_session_type` from Task 2.
- Produces: `?result_sent=0|1`, `?engaged=0|1`, and `whatsapp_clicked: 0 | 1` on every row of `leads[]` — all consumed by F-M3a.

- [ ] **Step 1: Write the failing test**

Append to `test/admin.test.ts` (note the new import needed at the top of the file — add `events as eventsTable` to the existing schema import):

```ts
describe('GET /api/admin/leads — sweep queue + engagement (B8)', () => {
	/** Mark a session as having tapped the WhatsApp CTA. */
	async function clicked(session_id: string) {
		await getDb(env).insert(eventsTable).values({
			id: crypto.randomUUID(),
			session_id,
			created_at: T,
			type: 'whatsapp_clicked',
			question_index: null,
			meta: null,
		});
	}

	async function list(query: string) {
		const res = await SELF.fetch(`https://x/api/admin/leads${query}`, { headers: auth });
		return { status: res.status, body: (await res.json()) as { leads: Array<{ first_name: string; whatsapp_clicked: number }>; total: number } };
	}

	it('reports whatsapp_clicked per lead', async () => {
		const tapped = crypto.randomUUID();
		await seed([
			{ first_name: 'Tapped', session_id: tapped },
			{ first_name: 'Quiet', session_id: crypto.randomUUID() },
		]);
		await clicked(tapped);

		const { body } = await list('');
		const byName = Object.fromEntries(body.leads.map((l) => [l.first_name, l.whatsapp_clicked]));
		expect(byName.Tapped).toBe(1);
		expect(byName.Quiet).toBe(0);
	});

	it('a click by an unrelated session does not mark a lead', async () => {
		await seed([{ first_name: 'Quiet', session_id: crypto.randomUUID() }]);
		await clicked(crypto.randomUUID()); // someone else entirely
		const { body } = await list('');
		expect(body.leads[0].whatsapp_clicked).toBe(0);
	});

	it('result_sent=0 returns only leads not yet sent', async () => {
		await seed([
			{ first_name: 'Pending', result_sent: 0 },
			{ first_name: 'Done', result_sent: 1 },
		]);
		const { body } = await list('?result_sent=0');
		expect(body.leads.map((l) => l.first_name)).toEqual(['Pending']);
		expect(body.total).toBe(1);
	});

	it('result_sent=1 returns only leads already sent', async () => {
		await seed([
			{ first_name: 'Pending', result_sent: 0 },
			{ first_name: 'Done', result_sent: 1 },
		]);
		const { body } = await list('?result_sent=1');
		expect(body.leads.map((l) => l.first_name)).toEqual(['Done']);
	});

	it('engaged=0 returns the finished-but-went-quiet list', async () => {
		const tapped = crypto.randomUUID();
		await seed([
			{ first_name: 'Tapped', session_id: tapped },
			{ first_name: 'Quiet', session_id: crypto.randomUUID() },
		]);
		await clicked(tapped);
		const { body } = await list('?engaged=0');
		expect(body.leads.map((l) => l.first_name)).toEqual(['Quiet']);
		expect(body.total).toBe(1);
	});

	it('engaged=1 returns only leads who tapped through', async () => {
		const tapped = crypto.randomUUID();
		await seed([
			{ first_name: 'Tapped', session_id: tapped },
			{ first_name: 'Quiet', session_id: crypto.randomUUID() },
		]);
		await clicked(tapped);
		const { body } = await list('?engaged=1');
		expect(body.leads.map((l) => l.first_name)).toEqual(['Tapped']);
	});

	it('the two filters combine', async () => {
		const tapped = crypto.randomUUID();
		await seed([
			{ first_name: 'QuietPending', session_id: crypto.randomUUID(), result_sent: 0 },
			{ first_name: 'QuietDone', session_id: crypto.randomUUID(), result_sent: 1 },
			{ first_name: 'TappedPending', session_id: tapped, result_sent: 0 },
		]);
		await clicked(tapped);
		const { body } = await list('?engaged=0&result_sent=0');
		expect(body.leads.map((l) => l.first_name)).toEqual(['QuietPending']);
	});

	it('F3.4 an invalid result_sent value → 400 invalid_filter', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads?result_sent=maybe', { headers: auth });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; field: string };
		expect(body.error).toBe('invalid_filter');
		expect(body.field).toBe('result_sent');
	});

	it('F3.4 an invalid engaged value → 400 invalid_filter', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads?engaged=yes', { headers: auth });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; field: string };
		expect(body.error).toBe('invalid_filter');
		expect(body.field).toBe('engaged');
	});

	it('is still 401 without credentials', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads?result_sent=0')).status).toBe(401);
	});
});
```

At the top of `test/admin.test.ts`, change the schema import to:

```ts
import { diagnostics, events as eventsTable } from '../src/db/schema';
```

and add an events cleanup to the existing `beforeEach`:

```ts
beforeEach(async () => {
	await getDb(env).delete(eventsTable);
	await getDb(env).delete(diagnostics);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- admin`
Expected: FAIL — `whatsapp_clicked` is `undefined` on every row and the new filters are ignored.

- [ ] **Step 3: Add the `whatsapp_clicked` expression and column**

In `src/routes/admin.ts`, import the events table by changing the schema import to:

```ts
import { diagnostics, events as eventsTable } from '../db/schema';
```

(It may already be imported this way for the analytics handler — if so, leave it.)

Above `LIST_COLUMNS`, add:

```ts
/**
 * Did this lead tap the WhatsApp CTA? A correlated EXISTS keeps the list at one COUNT +
 * one paged SELECT (no N+1); idx_events_session_type makes it a point lookup.
 */
const WHATSAPP_CLICKED = sql<number>`EXISTS (SELECT 1 FROM ${eventsTable} WHERE ${eventsTable.session_id} = ${diagnostics.session_id} AND ${eventsTable.type} = 'whatsapp_clicked')`;
```

Then add it as the last entry of `LIST_COLUMNS`:

```ts
	outcome: diagnostics.outcome,
	whatsapp_clicked: WHATSAPP_CLICKED,
};
```

- [ ] **Step 4: Add the two filters**

In the `admin.get('/leads', ...)` handler, after the existing `program` block and before the `from` block, add:

```ts
	if (q.result_sent !== undefined) {
		if (q.result_sent !== '0' && q.result_sent !== '1') {
			return c.json({ error: 'invalid_filter', field: 'result_sent', allowed: ['0', '1'] }, 400);
		}
		conds.push(eq(diagnostics.result_sent, q.result_sent === '1' ? 1 : 0));
	}

	if (q.engaged !== undefined) {
		if (q.engaged !== '0' && q.engaged !== '1') {
			return c.json({ error: 'invalid_filter', field: 'engaged', allowed: ['0', '1'] }, 400);
		}
		conds.push(sql`${WHATSAPP_CLICKED} = ${q.engaged === '1' ? 1 : 0}`);
	}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- admin`
Expected: all `admin.test.ts` tests PASS, including the ten new ones.

- [ ] **Step 6: Confirm the no-N+1 rule still holds**

Read the `/leads` handler top to bottom. It must still contain exactly two `await db...` calls: the `count()` and the paged `select`. If a loop or a per-row query has appeared, stop and fix it — the 10ms CPU budget depends on this.

Run: `npm test`
Expected: all pass.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.ts test/admin.test.ts
git commit -m "feat(admin): result_sent + engaged filters and a whatsapp_clicked column

The 2-day sweep needs 'everyone not sent yet' and the weekly review needs
'finished but never tapped WhatsApp'; neither was answerable. Engagement
resolves through a correlated EXISTS so the handler stays one COUNT plus
one paged SELECT."
```

---

### Task 7: Analytics — archetype and programme mix

The low-priority third block of the insights screen: who the quiz is attracting.

**Files:**
- Modify: `src/routes/admin.ts` (the `/analytics` handler)
- Test: `test/analytics.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `archetype_mix: Record<string, number>` and `program_mix: Record<string, number>` on the analytics response, consumed by F-M3b.

- [ ] **Step 1: Write the failing test**

Append to `test/analytics.test.ts`:

```ts
describe('GET /api/admin/analytics — audience mix (B8)', () => {
	async function analytics() {
		const res = await SELF.fetch('https://x/api/admin/analytics', { headers: auth });
		expect(res.status).toBe(200);
		return (await res.json()) as {
			archetype_mix: Record<string, number>;
			program_mix: Record<string, number>;
			totals: { leads: number };
		};
	}

	it('counts leads by archetype and by recommended programme', async () => {
		const db = getDb(env);
		for (const lead of [
			makeLead({ archetype: 'Time-Pressured', recommended_program: '$130 SAT Accelerator' }),
			makeLead({ archetype: 'Time-Pressured', recommended_program: '$130 SAT Accelerator' }),
			makeLead({ archetype: 'Untested Unknown', recommended_program: '$80 SAT Essentials' }),
		]) {
			await db.insert(diagnostics).values(lead);
		}

		const body = await analytics();
		expect(body.archetype_mix['Time-Pressured']).toBe(2);
		expect(body.archetype_mix['Untested Unknown']).toBe(1);
		expect(body.program_mix['$130 SAT Accelerator']).toBe(2);
		expect(body.program_mix['$80 SAT Essentials']).toBe(1);
	});

	it('the mixes sum to the total lead count', async () => {
		const db = getDb(env);
		for (const lead of [makeLead({ archetype: 'Plateaued Retaker' }), makeLead({ archetype: 'Shaky Grammarian' })]) {
			await db.insert(diagnostics).values(lead);
		}
		const body = await analytics();
		const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
		expect(sum(body.archetype_mix)).toBe(body.totals.leads);
		expect(sum(body.program_mix)).toBe(body.totals.leads);
	});

	it('returns empty mixes on an empty database rather than failing', async () => {
		const body = await analytics();
		expect(body.archetype_mix).toEqual({});
		expect(body.program_mix).toEqual({});
	});

	it('is still 401 without credentials', async () => {
		expect((await SELF.fetch('https://x/api/admin/analytics')).status).toBe(401);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- analytics`
Expected: FAIL — `archetype_mix` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `src/routes/admin.ts`, inside the `/analytics` handler, after the existing `outcomeRows` block and before the `return c.json({...})`, add:

```ts
		// Audience mix (B8): who the diagnostic is attracting. Plain COUNT/GROUP BY (F7.2).
		const archetypeRows = await db.select({ k: diagnostics.archetype, n: count() }).from(diagnostics).groupBy(diagnostics.archetype);
		const archetype_mix: Record<string, number> = {};
		for (const r of archetypeRows) archetype_mix[r.k] = r.n;

		const programRows = await db.select({ k: diagnostics.recommended_program, n: count() }).from(diagnostics).groupBy(diagnostics.recommended_program);
		const program_mix: Record<string, number> = {};
		for (const r of programRows) program_mix[r.k] = r.n;
```

Then add the two keys to the returned object, after `status_mix`:

```ts
			status_mix,
			archetype_mix,
			program_mix,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- analytics`
Expected: all `analytics.test.ts` tests PASS, including the four new ones.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: all pass.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin.ts test/analytics.test.ts
git commit -m "feat(admin): archetype and programme mix in analytics

Feeds the insights screen's 'who the quiz is attracting' block. Two plain
GROUP BY aggregates, consistent with the endpoint's existing F7.2 rule."
```

---

### Task 8: Documentation and dead config

Records B8 in the specs that CLAUDE.md makes the source of truth, and removes the `WHISH_LINK` test binding left behind when Whish was deleted.

**Files:**
- Modify: `docs/BACKEND_SPEC.md` (§6, after B7)
- Modify: `docs/PRD.md` (§18 frontend milestone list)
- Modify: `vitest.config.mts` (drop the dead `WHISH_LINK` binding)
- Modify: `README.md` (API table)

**Interfaces:**
- Consumes: everything above.
- Produces: docs that match the code.

- [ ] **Step 1: Remove the dead WHISH_LINK test binding**

In `vitest.config.mts`, delete this line from `miniflare.bindings`:

```ts
						WHISH_LINK: 'https://whish.money/pay/test',
```

Run: `npm test`
Expected: all pass — nothing reads that binding any more.

- [ ] **Step 2: Record B8 in BACKEND_SPEC §6**

In `docs/BACKEND_SPEC.md`, after the `### B7 — Hardening` block and before the `---` that ends §6, add:

```markdown
### B8 — Admin foundations (analytics instrumentation + leads-list capabilities)
- **Goal:** make the drop-off funnel possible and give the leads list the three
  capabilities the admin dashboard needs.
- **Files:** `web/src/lib/api.ts`, `web/src/components/DiagnosticFlow.tsx`,
  `src/routes/admin.ts`, `src/db/schema.ts`, a generated index migration,
  `test/admin.test.ts`, `test/analytics.test.ts`, `web/test/*`.
- **Scope:**
  - `postEvent` carries an optional `question_index`; `DiagnosticFlow` fires `start`,
    `advance` (1-based question number, Q1–Q17) and `contact_reached`. Only `completed`
    and `whatsapp_clicked` were previously wired up, so `funnel_by_question` was always
    `[]` and `started` always 0.
  - `GET /api/admin/leads`: `q` matches the normalised phone number as well as
    `first_name`; new `result_sent=0|1` and `engaged=0|1` filters; new
    `whatsapp_clicked: 0|1` column via a correlated EXISTS.
  - `GET /api/admin/analytics`: adds `archetype_mix` and `program_mix`.
  - Indexes: `events(session_id, type)`, `events(type, question_index)`,
    `diagnostics(created_at)`.
- **Tests:** phone search across stored formats; short queries do not match phones;
  both filters and their `400 invalid_filter` paths; `whatsapp_clicked` correctness;
  mixes sum to the lead total; the three events fire exactly once each.
- **DoD:** full Vitest suite green (Worker + web); typecheck clean; the leads handler is
  still one COUNT + one paged SELECT; the answer-key boundary guard passes.
```

- [ ] **Step 3: Update the PRD §18 milestone list**

In `docs/PRD.md` §18, replace the `F-M3` and `F-M4` bullets with:

```markdown
- **B8** — Admin foundations (backend): analytics instrumentation fix (`start` / `advance` /
  `contact_reached` were never fired, so the funnel had no data), leads-list phone search,
  `result_sent` + `engaged` filters, `whatsapp_clicked` column, archetype/programme mix,
  index migration. See `BACKEND_SPEC.md` §6 B8.
- **F-M3a** — Leads dashboard (React island behind Cloudflare Access): always-on search by
  name or number, a "to send" sweep queue, lead detail with the pre-filled one-tap WhatsApp
  action, mark-as-sent, and auto-saving manual fields.
- **F-M3b** — Insights screen: where students quit (17 question bars + the contact gate),
  who finished but never tapped WhatsApp, and a brief audience mix.
- **F-M4** — Polish: accessibility pass, privacy page, seed env vars (WhatsApp number),
  full §17 acceptance run.
- **F-M4c** — Deploy to production and lock `/admin` + `/api/admin/*` with a Cloudflare
  Access application allowing only the founder's email.
```

- [ ] **Step 4: Update the README API table**

In `README.md`, replace the `GET | /api/admin/leads` row with:

```markdown
| GET | `/api/admin/leads` | admin | List leads (filter by status/program/date/sent/engaged, search by name **or phone**, page) |
```

- [ ] **Step 5: Verify the docs match reality**

Re-read your BACKEND_SPEC B8 block against what you actually built in Tasks 1–7. Every bullet must be true. If anything drifted during implementation, the doc follows the code.

- [ ] **Step 6: Run the full gate**

```bash
npm run typecheck
npm test
npm --prefix web test
npm run build
```

Expected: all four clean.

- [ ] **Step 7: Commit**

```bash
git add docs/BACKEND_SPEC.md docs/PRD.md README.md vitest.config.mts
git commit -m "docs: record milestone B8; drop the dead WHISH_LINK test binding

BACKEND_SPEC §6 gains B8 and PRD §18 splits F-M3 into F-M3a/F-M3b with
F-M4c as the deploy step, matching the approved design spec."
```

---

## Definition of Done for B8

- `npm run typecheck` clean.
- `npm test` green (Worker suite).
- `npm --prefix web test` green (web suite), including the answer-key boundary guard.
- `npm run build` succeeds.
- `GET /api/admin/leads` still issues exactly one COUNT and one paged SELECT.
- No new dependency in either `package.json`.
- The three indexes exist in the local D1.
- `docs/BACKEND_SPEC.md` §6 and `docs/PRD.md` §18 describe what was actually built.

**Then stop and report to the owner** in plain language: what changed, the exact test commands, and the DoD result — per CLAUDE.md.
