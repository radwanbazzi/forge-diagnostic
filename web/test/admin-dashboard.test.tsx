/**
 * The leads dashboard (F-M3a) against the two jobs it exists for:
 *
 *   Job 1 — find a student fast: search is always on screen and matches a name OR a phone.
 *   Job 2 — the every-2-days sweep: "To send" is the default view, it carries a count,
 *           already-sent leads are visibly done, and one lead can be read, sent, marked
 *           and moved on from without going back to the list.
 *
 * Plus the rules that protect the data: computed fields are never editable, a broken
 * wa.me link is never rendered, and the action block sits ABOVE the result and answers
 * (design spec §5.3).
 *
 * Real timers throughout — the debounces are 250ms/600ms, and waiting for them honestly
 * is far less brittle than driving React, fetch promises and fake timers together.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '../src/components/AdminDashboard';
import type { LeadDetailRow, LeadSummary } from '../src/lib/adminApi';

// ── Fixtures ────────────────────────────────────────────────────────────────
const ID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const ID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const ID_C = 'cccccccc-1111-2222-3333-444444444444';

const NOW = Date.now();

const LEAD_A: LeadSummary = {
	id: ID_A,
	created_at: NOW - 3_600_000,
	first_name: 'Lina',
	whatsapp: '+961 70 123 456',
	school: 'International College',
	archetype: 'Time-Pressured',
	overall_band: '1150-1320',
	gap: 180,
	lead_score: 9,
	lead_status: 'HOT',
	recommended_program: '$130 SAT Accelerator',
	result_sent: 0,
	followup_status: 'None',
	outcome: '-',
	whatsapp_clicked: 1,
};

const LEAD_B: LeadSummary = {
	...LEAD_A,
	id: ID_B,
	created_at: NOW - 7_200_000,
	first_name: 'Karim',
	whatsapp: '03 999 888',
	archetype: 'Plateaued Retaker',
	overall_band: '1040-1200',
	gap: null,
	lead_score: 4,
	lead_status: 'COLD',
	recommended_program: '$80 SAT Essentials',
	result_sent: 1,
	whatsapp_clicked: 0,
};

/** A lead whose WhatsApp field holds no digits at all — the broken-link guard. */
const LEAD_C: LeadSummary = {
	...LEAD_A,
	id: ID_C,
	created_at: NOW - 10_800_000,
	first_name: 'Rami',
	whatsapp: 'ask mum',
	lead_status: 'WARM',
	lead_score: 6,
	result_sent: 0,
	whatsapp_clicked: 0,
};

function detailOf(summary: LeadSummary): LeadDetailRow {
	return {
		...summary,
		session_id: `sess-${summary.id}`,
		source: null,
		completion_time_sec: 420,
		skills_time_total_sec: 300,
		skills_timed_out_count: 1,
		skills_timings: JSON.stringify({ q5: { sec: 22, timed_out: false }, q9: { sec: 60, timed_out: true } }),
		target_score: '1350–1449',
		grade: 'Grade 11',
		test_date: '2–4 months',
		sat_history: 'Practice only — 1100–1299',
		q5: 'C) 300',
		q6: 'B) In addition',
		q7: 'B) 4',
		q8: 'B) self-reproach',
		q9: 'B) 96%',
		q10: 'B) ;',
		q11: 'A) 12',
		q12: 'B) Food may have been prepared or eaten outside the walled area.',
		hours_per_week: '2–4',
		timing: 'Run out of time on one section',
		review_mistakes: 'Sometimes',
		prep_status: 'On my own',
		worried_about: 'Running out of time',
		respondent_type: 'student',
		consent: 1,
		math_raw: 5,
		rw_raw: 6,
		confidence: 'Moderate',
		target_num: 1400,
		current_mid: 1220,
		timeline_verdict: 'Tight but doable',
		notes: null,
		result_payload: {
			band: { range: summary.overall_band, confidence: 'Moderate', sub: 'Based on 8 questions.' },
			profile: { archetype: summary.archetype, statement: 'You are Time-Pressured.', meaning: 'You know it; the clock beats you.' },
			reframe: { kind: 'reframe', text: 'This is a pacing problem, not an ability problem.' },
			section_read: 'Math and R&W are close.',
			top_fixes: ['Timed sets', 'Mistake log', 'Two full practice tests'],
			timeline: { verdict: 'Tight but doable', line: 'Ten weeks is enough if you start now.' },
			recommendation: { program: summary.recommended_program, text: 'Built for pacing.', guarantee: null },
			cta: { whatsapp_prefill: 'Hi Forge', whatsapp_url: null },
			meta: {
				first_name: summary.first_name,
				overall_band: summary.overall_band,
				archetype: summary.archetype,
				lead_status: summary.lead_status,
				recommended_program: summary.recommended_program,
			},
		},
		whatsapp_message: `Hi ${summary.first_name}! Here's your Forge SAT diagnostic result 👇\n\n📊 Estimated SAT range: ${summary.overall_band}`,
	};
}

// ── A fetch router standing in for the Worker ───────────────────────────────
interface Call {
	url: string;
	method: string;
	body?: unknown;
}

let calls: Call[];
let store: Record<string, LeadDetailRow>;
let allLeads: LeadSummary[];

function json(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function install(opts: { unauthorized?: boolean } = {}) {
	const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

		if (opts.unauthorized) return json({ error: 'unauthorized' }, 401);

		const one = url.match(/^\/api\/admin\/leads\/([^?]+)$/);
		if (one) {
			const id = decodeURIComponent(one[1]);
			const row = store[id];
			if (!row) return json({ error: 'not_found' }, 404);
			if (method === 'PATCH') {
				const patch = JSON.parse(init?.body as string) as Record<string, unknown>;
				const updated: LeadDetailRow = {
					...row,
					...(patch.result_sent !== undefined ? { result_sent: patch.result_sent ? 1 : 0 } : {}),
					...(patch.followup_status !== undefined ? { followup_status: patch.followup_status as LeadDetailRow['followup_status'] } : {}),
					...(patch.outcome !== undefined ? { outcome: patch.outcome as LeadDetailRow['outcome'] } : {}),
					...(patch.notes !== undefined ? { notes: patch.notes as string | null } : {}),
				};
				store[id] = updated;
				// The real Worker's PATCH handler returns the row WITHOUT whatsapp_message —
				// only the GET handler assembles it. Mirror that exactly: a mock that is more
				// generous than the server hides the bug where the CTA turns into
				// wa.me/…?text=undefined after a save.
				const { whatsapp_message: _omitted, ...withoutMessage } = updated;
				return json(withoutMessage);
			}
			return json(row);
		}

		if (url.startsWith('/api/admin/leads')) {
			const params = new URL(url, 'http://local').searchParams;
			let rows = allLeads;
			const sent = params.get('result_sent');
			if (sent !== null) rows = rows.filter((r) => String(r.result_sent) === sent);
			const q = params.get('q');
			if (q) {
				const digits = q.replace(/\D/g, '');
				rows = rows.filter(
					(r) =>
						r.first_name.toLowerCase().includes(q.toLowerCase()) ||
						(digits.length >= 3 && r.whatsapp.replace(/\D/g, '').includes(digits)),
				);
			}
			const limit = Number(params.get('limit') ?? 50);
			return json({ leads: rows.slice(0, limit), total: rows.length });
		}

		return json({ error: 'not_found' }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** The list request (limit=100), as opposed to the badge's limit=1 count query. */
function listCalls(): Call[] {
	return calls.filter((c) => c.method === 'GET' && c.url.includes('/api/admin/leads?') && c.url.includes('limit=100'));
}
function patchCalls(): Call[] {
	return calls.filter((c) => c.method === 'PATCH');
}

beforeEach(() => {
	calls = [];
	allLeads = [LEAD_A, LEAD_C, LEAD_B];
	store = Object.fromEntries([LEAD_A, LEAD_B, LEAD_C].map((l) => [l.id, detailOf(l)]));
	vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
	install();
});

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

/** Open a lead by name and wait for its detail pane. */
async function openLead(name: string) {
	fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
	return await screen.findByRole('complementary', { name: new RegExp(`Lead detail for ${name}`) });
}

// ── Job 2: the sweep ────────────────────────────────────────────────────────
describe('the sweep queue', () => {
	it('opens on "To send" and asks the server for result_sent=0', async () => {
		render(<AdminDashboard />);
		await screen.findByRole('button', { name: /^Lina/ });

		expect(listCalls()[0].url).toContain('result_sent=0');
		expect(screen.getByRole('button', { name: /^To send/ }).getAttribute('aria-current')).toBe('page');
	});

	it('shows a count badge of everything still to send, ignoring the search box', async () => {
		render(<AdminDashboard />);
		// Two of the three fixtures are unsent (Lina, Rami).
		const tab = await screen.findByRole('button', { name: /^To send/ });
		await waitFor(() => expect(within(tab).getByText('2')).toBeTruthy());

		fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Lina' } });
		await waitFor(() => expect(listCalls().some((c) => c.url.includes('q=Lina'))).toBe(true));
		// Still 2: the badge is how much work is left, not how much is on screen.
		expect(within(tab).getByText('2')).toBeTruthy();
	});

	it('marks an already-sent lead with a tick and greys its row', async () => {
		render(<AdminDashboard />);
		fireEvent.click(await screen.findByRole('button', { name: /^All leads/ }));

		const karim = await screen.findByRole('button', { name: /^Karim/ });
		expect(karim.textContent).toContain('✓');
		expect(karim.closest('tr')?.className).toContain('is-sent');

		// …and an unsent one is not ticked.
		expect(screen.getByRole('button', { name: /^Lina/ }).textContent).not.toContain('✓');
	});

	it('flags the leads who tapped the WhatsApp button', async () => {
		render(<AdminDashboard />);
		const linaRow = (await screen.findByRole('button', { name: /^Lina/ })).closest('tr')!;
		expect(within(linaRow).getByText('tapped you')).toBeTruthy();

		const ramiRow = screen.getByRole('button', { name: /^Rami/ }).closest('tr')!;
		expect(within(ramiRow).queryByText('tapped you')).toBeNull();
	});

	it('colour-codes the status and shows profile, programme and gap', async () => {
		render(<AdminDashboard />);
		const row = (await screen.findByRole('button', { name: /^Lina/ })).closest('tr')!;
		expect(within(row).getByText('HOT').className).toContain('al-pill-hot');
		expect(within(row).getByText('Time-Pressured')).toBeTruthy();
		expect(within(row).getByText('$130')).toBeTruthy();
		expect(within(row).getByText('+180')).toBeTruthy();

		// Karim has already been sent, so he is not in the default "To send" queue at all.
		expect(screen.queryByRole('button', { name: /^Karim/ })).toBeNull();
	});
});

// ── Job 1: find them fast ───────────────────────────────────────────────────
describe('search', () => {
	it('is on screen before anything is selected', () => {
		render(<AdminDashboard />);
		expect(screen.getByRole('searchbox')).toBeTruthy();
	});

	it('finds a lead by first name', async () => {
		render(<AdminDashboard />);
		await screen.findByRole('button', { name: /^Lina/ });

		fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Lina' } });
		await waitFor(() => expect(screen.queryByRole('button', { name: /^Rami/ })).toBeNull());
		expect(screen.getByRole('button', { name: /^Lina/ })).toBeTruthy();
	});

	it('finds a lead by phone number, in the format the owner would read off WhatsApp', async () => {
		render(<AdminDashboard />);
		fireEvent.click(await screen.findByRole('button', { name: /^All leads/ }));
		await screen.findByRole('button', { name: /^Karim/ });

		// Karim is already on screen, so wait for the OTHERS to drop away — that is what
		// proves the phone search ran, rather than the debounce simply not having fired.
		fireEvent.change(screen.getByRole('searchbox'), { target: { value: '999 888' } });
		await waitFor(() => expect(screen.queryByRole('button', { name: /^Lina/ })).toBeNull());
		expect(screen.getByRole('button', { name: /^Karim/ })).toBeTruthy();
	});

	it('debounces so a typed word is one request, not five', async () => {
		render(<AdminDashboard />);
		await screen.findByRole('button', { name: /^Lina/ });
		const before = listCalls().length;

		const box = screen.getByRole('searchbox');
		for (const v of ['L', 'Li', 'Lin', 'Lina']) fireEvent.change(box, { target: { value: v } });

		await waitFor(() => expect(listCalls().some((c) => c.url.includes('q=Lina'))).toBe(true));
		expect(listCalls().length - before).toBe(1);
	});

	it('says a search matched nothing, distinctly from having no leads', async () => {
		render(<AdminDashboard />);
		await screen.findByRole('button', { name: /^Lina/ });

		fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Zzzz' } });
		expect(await screen.findByText('Nothing matched that search')).toBeTruthy();
	});
});

describe('empty and error states', () => {
	it('says "all caught up" when the queue is empty, not nothing at all', async () => {
		allLeads = [LEAD_B]; // the only lead has already been sent
		render(<AdminDashboard />);
		expect(await screen.findByText("You're all caught up")).toBeTruthy();
	});

	it('says there are no leads yet when the database really is empty', async () => {
		allLeads = [];
		render(<AdminDashboard />);
		fireEvent.click(await screen.findByRole('button', { name: /^All leads/ }));
		expect(await screen.findByText('No leads yet')).toBeTruthy();
	});

	it('offers the local dev sign-in on a 401 (localhost)', async () => {
		install({ unauthorized: true });
		render(<AdminDashboard />);
		expect(await screen.findByText('Local development sign-in')).toBeTruthy();
		expect(screen.getByLabelText(/DEV_ADMIN_SECRET/)).toBeTruthy();
	});

	it('retries with the dev headers once the secret is entered', async () => {
		const first = install({ unauthorized: true });
		render(<AdminDashboard />);
		await screen.findByText('Local development sign-in');

		fireEvent.change(screen.getByLabelText(/DEV_ADMIN_SECRET/), { target: { value: 'local-dev-secret' } });
		fireEvent.change(screen.getByLabelText(/ADMIN_EMAIL/), { target: { value: 'founder@example.com' } });

		install(); // the Worker now accepts us
		fireEvent.click(screen.getByRole('button', { name: 'Sign in locally' }));

		await screen.findByRole('button', { name: /^Lina/ });
		const authed = calls.filter((c) => c.url.includes('/api/admin/leads'));
		expect(authed.length).toBeGreaterThan(0);
		expect(first).toHaveBeenCalled();
	});
});

// ── The lead detail ─────────────────────────────────────────────────────────
describe('lead detail', () => {
	it('puts the message and the WhatsApp button ABOVE the result and the answers', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		const action = detail.querySelector('.ad-action')!;
		const folds = detail.querySelectorAll('details');
		expect(folds.length).toBe(2);
		for (const fold of folds) {
			// DOCUMENT_POSITION_FOLLOWING === the fold comes after the action block.
			expect(action.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
	});

	it('shows the ready-to-send message in full', async () => {
		const detail = await (render(<AdminDashboard />), openLead('Lina'));
		expect(detail.querySelector('.ad-message')?.textContent).toContain("Here's your Forge SAT diagnostic result");
	});

	it('names the exact number the WhatsApp button will open, and encodes the message', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		const link = within(detail).getByRole('link', { name: /Open WhatsApp/ }) as HTMLAnchorElement;
		expect(link.textContent).toContain('+96170123456');
		expect(link.href).toContain('https://wa.me/96170123456?text=');
		expect(link.href).toContain(encodeURIComponent('Here'));
	});

	it('disables the button instead of rendering a broken wa.me link', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Rami'); // whatsapp: "ask mum" → no digits

		expect(within(detail).queryByRole('link', { name: /Open WhatsApp/ })).toBeNull();
		const disabled = within(detail).getByRole('button', { name: /No usable phone number/ });
		expect(disabled).toHaveProperty('disabled', true);
		expect(detail.innerHTML).not.toContain('wa.me');
	});

	it('warns when a stored number is local-only, since wa.me cannot dial it', async () => {
		render(<AdminDashboard />);
		fireEvent.click(await screen.findByRole('button', { name: /^All leads/ }));
		const detail = await openLead('Karim'); // "03 999 888"
		expect(within(detail).getByText(/looks like a local number/)).toBeTruthy();
	});

	it('keeps the result and the 22 answers collapsed until asked', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		const folds = Array.from(detail.querySelectorAll('details'));
		expect(folds.every((f) => !f.open)).toBe(true);

		fireEvent.click(within(detail).getByText('All 22 answers'));
		const answers = within(detail.querySelector('.ad-answers') as HTMLElement);
		expect(answers.getByText(/What SAT score are you aiming for/)).toBeTruthy();
		expect(answers.getByText('Grade 11')).toBeTruthy(); // Q2's answer
		expect(answers.getByText(/Which school do you attend/)).toBeTruthy(); // all 22, not just the scored ones
		// The measured skills timing rides along with the answers.
		expect(answers.getByText(/ran out of time/)).toBeTruthy();
	});

	it('renders score, band and archetype as text with no control to edit them', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');
		fireEvent.click(within(detail).getByText('Full result'));

		expect(within(detail).getByText('score 9')).toBeTruthy();
		expect(within(detail).getAllByText('1150-1320').length).toBeGreaterThan(0);

		// The ONLY inputs in the whole pane are the three manual fields.
		const editable = detail.querySelectorAll('input, select, textarea');
		expect(Array.from(editable).map((el) => el.id).sort()).toEqual(['ad-followup', 'ad-notes', 'ad-outcome']);
	});
});

describe('working a lead', () => {
	it('marks it sent and greys the row, without yanking it out from under the owner', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		fireEvent.click(within(detail).getByRole('button', { name: 'Mark sent' }));

		await waitFor(() => expect(patchCalls()).toHaveLength(1));
		expect(patchCalls()[0].body).toEqual({ result_sent: true });
		expect(patchCalls()[0].url).toContain(ID_A);

		// The detail stays open and now reads as sent…
		expect(await within(detail).findByText('Sent ✓')).toBeTruthy();
		// …and the row behind it is ticked and greyed rather than disappearing.
		await waitFor(() => expect(screen.getByRole('button', { name: /^Lina/ }).textContent).toContain('✓'));
		expect(screen.getByRole('button', { name: /^Lina/ }).closest('tr')?.className).toContain('is-sent');
	});

	it('keeps the message and a working wa.me link after a save', async () => {
		// Regression: PATCH returns the row WITHOUT whatsapp_message, so replacing the lead
		// with the response blanked the message and produced wa.me/…?text=undefined — the
		// exact failure the design spec calls out. The response must be MERGED, not assigned.
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		const hrefBefore = (within(detail).getByRole('link', { name: /Open WhatsApp/ }) as HTMLAnchorElement).getAttribute('href')!;
		fireEvent.click(within(detail).getByRole('button', { name: 'Mark sent' }));
		await within(detail).findByText('Sent ✓');

		const link = within(detail).getByRole('link', { name: /Open WhatsApp/ }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe(hrefBefore);
		expect(link.getAttribute('href')).not.toContain('undefined');
		expect(detail.querySelector('.ad-message')?.textContent).toContain("Here's your Forge SAT diagnostic result");
	});

	it('auto-saves the follow-up status with no save button', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		expect(within(detail).queryByRole('button', { name: /^Save/ })).toBeNull();
		fireEvent.change(within(detail).getByLabelText('Follow-up'), { target: { value: 'Msg1 sent' } });

		await waitFor(() => expect(patchCalls()).toHaveLength(1));
		expect(patchCalls()[0].body).toEqual({ followup_status: 'Msg1 sent' });
		expect(await within(detail).findByText('Saved')).toBeTruthy();
	});

	it('auto-saves the outcome', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		fireEvent.change(within(detail).getByLabelText('Outcome'), { target: { value: 'Enrolled $130' } });
		await waitFor(() => expect(patchCalls()).toHaveLength(1));
		expect(patchCalls()[0].body).toEqual({ outcome: 'Enrolled $130' });
	});

	it('debounces notes into one save, not one per keystroke', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		const notes = within(detail).getByLabelText('Notes');
		for (const v of ['C', 'Ca', 'Cal', 'Call', 'Called']) fireEvent.change(notes, { target: { value: v } });

		await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 3000 });
		expect(patchCalls()[0].body).toEqual({ notes: 'Called' });
	});

	it('keeps what was typed when the save fails, and says so', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		install({ unauthorized: false });
		vi.mocked(fetch).mockImplementation(((input: RequestInfo | URL, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'PATCH') return json({ error: 'server_error' }, 500);
			return json({ leads: allLeads, total: allLeads.length });
		}) as typeof fetch);

		fireEvent.change(within(detail).getByLabelText('Notes'), { target: { value: 'Do not lose me' } });

		expect(await within(detail).findByText(/Request failed: 500/, undefined, { timeout: 3000 })).toBeTruthy();
		expect((within(detail).getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Do not lose me');
	});

	it('moves to the next lead in the queue without going back to the list', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		fireEvent.click(within(detail).getByRole('button', { name: /Next lead/ }));
		expect(await screen.findByRole('complementary', { name: /Lead detail for Rami/ })).toBeTruthy();
	});

	it('offers no "next" on the last lead in the queue', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Rami'); // last unsent in the fixture order
		expect(within(detail).queryByRole('button', { name: /Next lead/ })).toBeNull();
	});

	it('saves a note still inside its debounce window when the lead is closed', async () => {
		render(<AdminDashboard />);
		const detail = await openLead('Lina');

		fireEvent.change(within(detail).getByLabelText('Notes'), { target: { value: 'Parent called' } });
		fireEvent.click(within(detail).getByRole('button', { name: /Back/ })); // immediately, mid-debounce

		await waitFor(() => expect(patchCalls()).toHaveLength(1));
		expect(patchCalls()[0].body).toEqual({ notes: 'Parent called' });
	});
});
