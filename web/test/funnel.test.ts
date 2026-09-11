/**
 * buildFunnel() turns the sparse analytics response into the full drop-off ladder the
 * insights screen draws (design spec §6.1).
 *
 * The two things it must never get wrong:
 *   1. The boundary. "Quit during the questions" and "quit when asked for a phone number"
 *      are different problems with different fixes, so they are counted separately.
 *   2. Honesty. Beacons are fire-and-forget and can be dropped, so the counts are not
 *      guaranteed to fall monotonically. A negative loss must never be rendered.
 */
import { describe, expect, it } from 'vitest';
import { buildFunnel, QUESTION_STEPS } from '../src/lib/funnel';
import type { Analytics } from '../src/lib/adminApi';

const EMPTY: Analytics = {
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

function analytics(over: Partial<Analytics>): Analytics {
	return { ...EMPTY, ...over };
}

/** Every question 1..17, reached by `counts[n-1]` sessions. */
function questions(counts: number[]): Analytics['funnel_by_question'] {
	return counts.map((count, i) => ({ question_index: i + 1, count }));
}

describe('the ladder', () => {
	it('always has 17 questions, then the contact gate, then completed', () => {
		const { steps } = buildFunnel(EMPTY);
		expect(steps).toHaveLength(19);
		expect(steps.slice(0, 17).every((s) => s.kind === 'question')).toBe(true);
		expect(steps[17].kind).toBe('contact-gate');
		expect(steps[18].kind).toBe('completed');
	});

	it('labels every question step with its real question text, not an index', () => {
		const { steps } = buildFunnel(EMPTY);
		expect(steps[0].label).toBe('Q1');
		expect(steps[0].detail).toBe('What SAT score are you aiming for?');
		expect(steps[7].label).toBe('Q8');
		expect(steps[7].detail).toContain('unsparing about her own early missteps');
		expect(steps[16].detail).toBe('Which part of the SAT worries you most?');
	});

	it('groups the questions into the three real sections', () => {
		const { steps } = buildFunnel(EMPTY);
		expect(steps[0].section).toBe(1); // Q1-Q4 about you
		expect(steps[4].section).toBe(2); // Q5-Q12 skills check
		expect(steps[12].section).toBe(3); // Q13-Q17 how you study
	});

	it('exposes the same 17 steps as a constant so the empty state can draw the ladder', () => {
		expect(QUESTION_STEPS).toHaveLength(17);
		expect(QUESTION_STEPS[0].n).toBe(1);
		expect(QUESTION_STEPS[16].n).toBe(17);
	});

	it('has a written short topic for every question, so no headline falls back to a field name', () => {
		// The topics are hand-written in funnel.ts. If a question is ever added or renumbered,
		// this fails rather than silently printing "quit at Q18 - sat_history" at the founder.
		for (const step of QUESTION_STEPS) {
			expect(step.topic, `Q${step.n} has no topic`).toBeTruthy();
			expect(step.topic, `Q${step.n} fell back to its field name`).not.toMatch(/^[a-z_0-9]+$/);
		}
	});
});

describe('with no data at all', () => {
	it('reports hasData false and every count zero', () => {
		const { steps, summary } = buildFunnel(EMPTY);
		expect(summary.hasData).toBe(false);
		expect(summary.started).toBe(0);
		expect(summary.quitInQuestions).toBe(0);
		expect(summary.quitAtContactGate).toBe(0);
		expect(steps.every((s) => s.reached === 0 && s.lost === 0 && s.share === 0)).toBe(true);
	});

	it('never flags a biggest loss when there is nothing to lose', () => {
		expect(buildFunnel(EMPTY).steps.some((s) => s.isBigLoss)).toBe(false);
	});
});

describe('counting reached and lost', () => {
	const a = analytics({
		started: 30,
		contact_reached: 20,
		completed: 12,
		funnel_by_question: questions([30, 30, 29, 29, 28, 28, 28, 21, 21, 21, 21, 20, 20, 20, 20, 20, 20]),
	});

	it('counts how many reached each step', () => {
		const { steps } = buildFunnel(a);
		expect(steps[0].reached).toBe(30); // Q1
		expect(steps[7].reached).toBe(21); // Q8
		expect(steps[17].reached).toBe(20); // contact gate
		expect(steps[18].reached).toBe(12); // completed
	});

	it('counts losses as "reached this step and never reached the next"', () => {
		const { steps } = buildFunnel(a);
		expect(steps[6].lost).toBe(7); // 28 reached Q7, 21 reached Q8
		expect(steps[0].lost).toBe(0); // 30 -> 30
		expect(steps[16].lost).toBe(0); // Q17 20 -> contact gate 20
		expect(steps[17].lost).toBe(8); // contact gate 20 -> completed 12
	});

	it('gives the last step no loss of its own', () => {
		expect(buildFunnel(a).steps[18].lost).toBe(0);
	});

	it('splits the two failures the owner needs to tell apart', () => {
		const { summary } = buildFunnel(a);
		expect(summary.quitInQuestions).toBe(10); // 30 started, 20 reached the contact gate
		expect(summary.quitAtContactGate).toBe(8); // 20 reached it, 12 finished
		expect(summary.started).toBe(30);
		expect(summary.completed).toBe(12);
		expect(summary.hasData).toBe(true);
	});

	it('flags the three biggest losses', () => {
		const { steps } = buildFunnel(a);
		const flagged = steps.filter((s) => s.isBigLoss).map((s) => s.label);
		expect(flagged).toContain('Q7'); // 7 lost
		expect(flagged).toContain('Contact details'); // 8 lost
		expect(flagged).toHaveLength(3);
	});

	it('expresses each step as a share of everyone who started', () => {
		const { steps } = buildFunnel(a);
		expect(steps[0].share).toBe(1); // 30/30
		expect(steps[18].share).toBeCloseTo(0.4, 5); // 12/30
	});
});

describe('honesty guards', () => {
	it('never reports a negative loss when a beacon was dropped', () => {
		// Q2 reports FEWER sessions than Q3 - impossible in a real flow, so a lost beacon.
		const { steps } = buildFunnel(
			analytics({
				started: 10,
				contact_reached: 5,
				completed: 5,
				funnel_by_question: questions([10, 4, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 5]),
			}),
		);
		expect(steps.every((s) => s.lost >= 0)).toBe(true);
		expect(steps[1].lost).toBe(0); // 4 -> 9 is not a loss of -5
	});

	it('never reports a share above 100%, even when a start beacon was dropped', () => {
		const { steps, summary } = buildFunnel(
			analytics({
				started: 2,
				contact_reached: 9,
				completed: 9,
				funnel_by_question: questions(Array(17).fill(10)),
			}),
		);
		expect(steps.every((s) => s.share <= 1)).toBe(true);
		expect(summary.started).toBe(10); // the baseline falls back to the largest step
	});

	it('clamps both halves of the boundary split at zero', () => {
		// Contradictory counts: more sessions completed than ever reached the contact screen.
		const { summary } = buildFunnel(
			analytics({ started: 5, contact_reached: 8, completed: 9, funnel_by_question: questions(Array(17).fill(5)) }),
		);
		expect(summary.quitAtContactGate).toBe(0); // 8 reached, 9 completed - never -1
		expect(summary.quitInQuestions).toBeGreaterThanOrEqual(0);
	});

	it('ignores question numbers outside the 17 question screens', () => {
		// Section 4 has no per-question advance, so a 19 here is stale or bogus data.
		const { steps } = buildFunnel(
			analytics({
				started: 3,
				contact_reached: 3,
				completed: 3,
				funnel_by_question: [...questions(Array(17).fill(3)), { question_index: 19, count: 99 }],
			}),
		);
		expect(steps).toHaveLength(19);
		expect(steps.every((s) => s.reached <= 3)).toBe(true);
	});

	it('treats a question with no events at all as zero rather than dropping its bar', () => {
		const { steps } = buildFunnel(
			analytics({ started: 4, contact_reached: 0, completed: 0, funnel_by_question: [{ question_index: 1, count: 4 }] }),
		);
		expect(steps).toHaveLength(19);
		expect(steps[1].reached).toBe(0);
		expect(steps[0].lost).toBe(4); // everyone who reached Q1 stopped there
	});
});
