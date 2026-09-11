/**
 * The insights screen (F-M3b), driven through the real dashboard so the tab wiring,
 * the two fetches and the shared lead-detail pane are all exercised together.
 *
 * What it must get right, in the owner's words:
 *   - where students quit, labelled with the real question, not "question_index: 7";
 *   - the boundary between the QUESTIONS and the CONTACT GATE, visible at a glance,
 *     because those are different problems with different fixes;
 *   - "finished but went quiet" as an actionable list, not a statistic;
 *   - and — since this ships with zero traffic — empty views that say what will appear
 *     here and what has to happen to fill them, never a bare "no data".
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '../src/components/AdminDashboard';
import type { Analytics, LeadDetailRow, LeadSummary } from '../src/lib/adminApi';

const ID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const ID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const NOW = Date.now();

const QUIET_LEAD: LeadSummary = {
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
	whatsapp_clicked: 0,
};

/** Tapped WhatsApp, so this one must NEVER appear in the went-quiet list. */
const ENGAGED_LEAD: LeadSummary = {
	...QUIET_LEAD,
	id: ID_B,
	first_name: 'Karim',
	lead_status: 'COLD',
	whatsapp_clicked: 1,
	result_sent: 1,
};

const POPULATED: Analytics = {
	started: 30,
	completed: 12,
	contact_reached: 20,
	completion_rate: 0.4,
	// 30 through Q6, 28 reach Q7, then 21 from Q8 - the big drop is at Q7.
	funnel_by_question: [30, 30, 29, 29, 28, 28, 28, 21, 21, 21, 21, 20, 20, 20, 20, 20, 20].map((count, i) => ({
		question_index: i + 1,
		count,
	})),
	status_mix: { HOT: 5, WARM: 4, COLD: 3 },
	archetype_mix: { 'Time-Pressured': 7, 'Plateaued Retaker': 5 },
	program_mix: { '$130 SAT Accelerator': 8, '$80 SAT Essentials': 4 },
	whatsapp_click_rate: 0.5,
	enrollment_rate: 0.25,
	totals: { leads: 12, enrolled: 3, whatsapp_clicked: 6 },
};

const NO_DATA: Analytics = {
	started: 0,
	completed: 0,
	contact_reached: 0,
	completion_rate: 0,
	funnel_by_question: [],
	status_mix: { HOT: 0, WARM: 0, COLD: 0 },
	archetype_mix: {},
	program_mix: {},
	whatsapp_click_rate: 0,
	enrollment_rate: 0,
	totals: { leads: 0, enrolled: 0, whatsapp_clicked: 0 },
};

// ── A fetch router standing in for the Worker ───────────────────────────────
interface Call {
	url: string;
	method: string;
}
let calls: Call[];
let analytics: Analytics;
let allLeads: LeadSummary[];

function json(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function detailOf(summary: LeadSummary): LeadDetailRow {
	return {
		...summary,
		session_id: `sess-${summary.id}`,
		source: null,
		completion_time_sec: 420,
		skills_time_total_sec: 300,
		skills_timed_out_count: 1,
		skills_timings: null,
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
		timing: 'Finish right on time',
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
		result_payload: null,
		whatsapp_message: `Hi ${summary.first_name}!`,
	};
}

function install(opts: { unauthorized?: boolean; analyticsFails?: boolean } = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, method: init?.method ?? 'GET' });
			if (opts.unauthorized) return json({ error: 'unauthorized' }, 401);

			if (url.startsWith('/api/admin/analytics')) {
				if (opts.analyticsFails) return json({ error: 'server_error' }, 500);
				return json(analytics);
			}

			const one = url.match(/^\/api\/admin\/leads\/([^?]+)$/);
			if (one) {
				const row = allLeads.find((l) => l.id === decodeURIComponent(one[1]));
				return row ? json(detailOf(row)) : json({ error: 'not_found' }, 404);
			}

			if (url.startsWith('/api/admin/leads')) {
				const params = new URL(url, 'http://local').searchParams;
				let rows = allLeads;
				const engaged = params.get('engaged');
				if (engaged !== null) rows = rows.filter((r) => String(r.whatsapp_clicked) === engaged);
				const sent = params.get('result_sent');
				if (sent !== null) rows = rows.filter((r) => String(r.result_sent) === sent);
				return json({ leads: rows.slice(0, Number(params.get('limit') ?? 50)), total: rows.length });
			}

			return json({ error: 'not_found' }, 404);
		}),
	);
}

beforeEach(() => {
	calls = [];
	analytics = POPULATED;
	allLeads = [QUIET_LEAD, ENGAGED_LEAD];
	install();
});

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

/** Switch to the Insights tab and wait for the funnel to land. */
async function openInsights() {
	fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
	return await screen.findByRole('region', { name: 'Where students quit' });
}

// ── The tab itself ──────────────────────────────────────────────────────────
describe('the Insights tab', () => {
	it('is live, not the inert placeholder it was in F-M3a', () => {
		render(<AdminDashboard />);
		const tab = screen.getByRole('button', { name: 'Insights' });
		expect(tab.hasAttribute('disabled')).toBe(false);
	});

	it('reads the analytics endpoint and the went-quiet list, and nothing else', async () => {
		render(<AdminDashboard />);
		await openInsights();
		await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/admin/analytics'))).toBe(true));
		expect(calls.some((c) => c.url.includes('engaged=0'))).toBe(true);
	});

	it('hands a search back to the leads tab, so lookup still works from here', async () => {
		render(<AdminDashboard />);
		await openInsights();
		fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Lina' } });
		await screen.findByRole('button', { name: /^Lina/ });
		expect(screen.queryByRole('region', { name: 'Where students quit' })).toBeNull();
	});
});

// ── Block 1: where students quit ────────────────────────────────────────────
describe('the drop-off funnel', () => {
	it('labels each step with its real question text, never a bare index', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();
		expect(within(funnel).getByText('What SAT score are you aiming for?')).toBeTruthy();
		expect(within(funnel).getByText('Which part of the SAT worries you most?')).toBeTruthy();
		expect(within(funnel).queryByText(/question_index/)).toBeNull();
	});

	it('names the biggest drop in plain language', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();
		// The worst single drop here is the gate: 20 reached it, 12 finished.
		expect(within(funnel).getByText(/8 of 30 quit at the moment you ask for a phone number\./)).toBeTruthy();
	});

	it('names the question itself when the worst drop is inside the quiz', async () => {
		// Same funnel, but everyone who reaches the contact screen finishes - so Q7's
		// loss of 7 is now the worst, and the headline must say which question that is.
		analytics = { ...POPULATED, completed: 20, contact_reached: 20 };
		render(<AdminDashboard />);
		const funnel = await openInsights();
		expect(within(funnel).getByText(/7 of 30 quit at Q7 — the quadratic one\./)).toBeTruthy();
	});

	it('marks the boundary between the questions and the contact gate', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();
		expect(within(funnel).getByText(/Contact gate — everything below is after you ask for a name & number/)).toBeTruthy();
	});

	it('totals the two failures separately, because they need different fixes', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();

		const inQuestions = within(funnel).getByText('quit during the questions').closest('.af-split-card');
		const atGate = within(funnel).getByText('quit at the contact gate').closest('.af-split-card');
		expect(inQuestions).toBeTruthy();
		expect(atGate).toBeTruthy();

		// 30 started, 20 reached the contact screen -> 10 lost in the quiz.
		expect(within(inQuestions as HTMLElement).getByText('10')).toBeTruthy();
		// 20 reached it, 12 finished -> 8 refused to hand over a number.
		expect(within(atGate as HTMLElement).getByText('8')).toBeTruthy();
	});

	it('says out loud how the counts should be read', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();
		expect(within(funnel).getByText(/means seven students saw Q8 and never reached Q9/)).toBeTruthy();
	});

	it('flags the three biggest losses', async () => {
		render(<AdminDashboard />);
		const funnel = await openInsights();
		expect(within(funnel).getAllByText('one of the 3 biggest')).toHaveLength(3);
	});
});

// ── Block 2: finished but went quiet ────────────────────────────────────────
describe('finished but went quiet', () => {
	it('lists only the leads who never tapped WhatsApp', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const quiet = await screen.findByRole('region', { name: 'Finished but went quiet' });
		expect(within(quiet).getByText('Lina')).toBeTruthy();
		expect(within(quiet).queryByText('Karim')).toBeNull();
	});

	it('opens the lead, so the list is actionable and not just a count', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const quiet = await screen.findByRole('region', { name: 'Finished but went quiet' });
		fireEvent.click(within(quiet).getByRole('button', { name: /Lina/ }));
		expect(await screen.findByRole('complementary', { name: /Lead detail for Lina/ })).toBeTruthy();
	});

	it('admits that a WhatsApp tap is a proxy, not proof', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const quiet = await screen.findByRole('region', { name: 'Finished but went quiet' });
		expect(within(quiet).getByText(/proxy for starting a chat, not proof of one/)).toBeTruthy();
	});
});

// ── Block 3: who the quiz is attracting ─────────────────────────────────────
describe('the audience mix', () => {
	it('shows the status, profile and programme splits', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const mix = await screen.findByRole('region', { name: 'Who the quiz is attracting' });
		expect(within(mix).getByText('HOT')).toBeTruthy();
		expect(within(mix).getByText('Time-Pressured')).toBeTruthy();
		expect(within(mix).getByText('$130 SAT Accelerator')).toBeTruthy();
	});

	it('shows the three headline rates', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const mix = await screen.findByRole('region', { name: 'Who the quiz is attracting' });
		expect(within(mix).getByText('40%')).toBeTruthy(); // completion
		expect(within(mix).getByText('50%')).toBeTruthy(); // whatsapp taps
		expect(within(mix).getByText('25%')).toBeTruthy(); // enrolments
	});
});

// ── Day one: zero traffic ───────────────────────────────────────────────────
describe('with no data at all', () => {
	beforeEach(() => {
		analytics = NO_DATA;
		allLeads = [];
	});

	it('still draws the whole ladder, with the real questions, so the screen is legible', async () => {
		render(<AdminDashboard />);
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		const funnel = await screen.findByRole('region', { name: 'Where students quit' });
		expect(within(funnel).getByText('What SAT score are you aiming for?')).toBeTruthy();
		expect(within(funnel).getByText(/Contact gate — everything below is after you ask/)).toBeTruthy();
	});

	it('explains what the funnel will show and what fills it in', async () => {
		render(<AdminDashboard />);
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		const funnel = await screen.findByRole('region', { name: 'Where students quit' });
		expect(within(funnel).getByText('No drop-off data yet')).toBeTruthy();
		expect(within(funnel).getByText(/becomes a bar showing how many students reached it/)).toBeTruthy();
		expect(within(funnel).getByText(/To fill this in:/)).toBeTruthy();
	});

	it('explains what the went-quiet list is for before anyone has finished', async () => {
		render(<AdminDashboard />);
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		const quiet = await screen.findByRole('region', { name: 'Finished but went quiet' });
		expect(within(quiet).getByText('Nobody has finished the diagnostic yet')).toBeTruthy();
		expect(within(quiet).getByText(/This becomes your warm list/)).toBeTruthy();
	});

	it('explains what the audience mix will show', async () => {
		render(<AdminDashboard />);
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		const mix = await screen.findByRole('region', { name: 'Who the quiz is attracting' });
		expect(within(mix).getByText('No finished diagnostics yet')).toBeTruthy();
		expect(within(mix).getByText(/HOT \/ WARM \/ COLD/)).toBeTruthy();
	});

	it('never renders a bare "no data" anywhere on the screen', async () => {
		render(<AdminDashboard />);
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		await screen.findByRole('region', { name: 'Where students quit' });
		expect(screen.queryByText(/^no data$/i)).toBeNull();
	});
});

// ── "Everyone tapped through" is not the same as "nobody finished" ──────────
describe('when every finisher tapped WhatsApp', () => {
	beforeEach(() => {
		allLeads = [ENGAGED_LEAD];
	});

	it('says so, rather than reusing the nobody-has-finished copy', async () => {
		render(<AdminDashboard />);
		await openInsights();
		const quiet = await screen.findByRole('region', { name: 'Finished but went quiet' });
		expect(within(quiet).getByText('Everyone who finished tapped through')).toBeTruthy();
		expect(within(quiet).queryByText('Nobody has finished the diagnostic yet')).toBeNull();
	});
});

// ── Failure states ──────────────────────────────────────────────────────────
describe('failures', () => {
	it('shows the Access-expired screen on a 401, not a broken chart', async () => {
		install({ unauthorized: true });
		render(<AdminDashboard />);
		expect(await screen.findByText(/Local development sign-in|Your Access session expired/)).toBeTruthy();
	});

	it('reports a failed analytics read instead of rendering an empty funnel', async () => {
		install({ analyticsFails: true });
		render(<AdminDashboard />);
		await screen.findByRole('button', { name: /^Lina/ });
		fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
		expect(await screen.findByText('Could not load your insights')).toBeTruthy();
		expect(screen.queryByRole('region', { name: 'Where students quit' })).toBeNull();
	});
});
