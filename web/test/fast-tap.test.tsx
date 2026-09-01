/**
 * Interactive-flow guards: the "submit 400" debounce AND the F-M-Timer countdown.
 *
 * (These live in one file on purpose — the web test config runs a single worker on this
 * Windows path, so keeping the flow tests together keeps `npm test` reliable.)
 *
 * Part 1 — the "submit 400" (the real one): the diagnostic auto-advances 160ms after each
 * tap. The original code scheduled that advance on EVERY tap, so tapping faster than 160ms
 * (a rushing student, or a mobile double-tap) queued two advances and jumped two questions at
 * once — the skipped question was never answered, and the submission 400'd because `answers`
 * was incomplete. These tests simulate fast tapping with fake timers; if the debounce/lock in
 * DiagnosticFlow ever regresses, a tap skips a question and the "Question N of 17" assertions
 * fail — so the build fails instead of shipping a broken flow.
 *
 * Part 2 — the per-question countdown (F-M-Timer): the 8 skills questions (Section 2) are
 * timed; context questions are not; and a countdown that runs out auto-advances instead of
 * stranding the student. (The measurement + "fast-careless is NOT Time-Pressured / slow IS"
 * archetype rule are proven end-to-end in the backend suite.)
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import DiagnosticFlow from '../src/components/DiagnosticFlow';
import { SKILLS_TIME_LIMIT_SEC } from '../../src/lib/questions';

const ADVANCE_MS = 160;

afterEach(cleanup);

/** The first answer option on the current question screen. */
function firstOption(container: HTMLElement): HTMLElement {
	const btn = container.querySelector('.fd-options button');
	if (!btn) throw new Error('no answer option rendered on the current screen');
	return btn as HTMLElement;
}

/** Answer the current question by clicking its first option, then run the auto-advance. */
function answerCurrent(container: HTMLElement) {
	fireEvent.click(firstOption(container));
	act(() => {
		vi.advanceTimersByTime(ADVANCE_MS);
	});
}

test('a rapid double-tap advances exactly one question — never skips', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);
		expect(screen.getByText('Question 1 of 17')).toBeTruthy();

		// Two taps well inside the 160ms auto-advance window.
		const option = firstOption(container);
		fireEvent.click(option);
		fireEvent.click(option);

		// Fire whatever advance was scheduled.
		act(() => {
			vi.advanceTimersByTime(ADVANCE_MS * 2);
		});

		// Must be on Q2. The pre-fix bug landed on Q3, leaving Q2 unanswered.
		expect(screen.queryByText('Question 3 of 17')).toBeNull();
		expect(screen.getByText('Question 2 of 17')).toBeTruthy();
	} finally {
		vi.useRealTimers();
	}
});

test('double-tapping through all 17 questions skips none and reaches the contact step', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);

		for (let n = 1; n <= 17; n++) {
			// getByText throws if we are not on the expected question — i.e. a tap skipped one.
			expect(screen.getByText(`Question ${n} of 17`)).toBeTruthy();
			const option = firstOption(container);
			fireEvent.click(option); // fast
			fireEvent.click(option); // double-tap
			act(() => {
				vi.advanceTimersByTime(ADVANCE_MS * 2);
			});
		}

		// After all 17 answered, we land on the Section-4 contact screen — not stuck or skipped past.
		expect(screen.getByText('Where should we send your results?')).toBeTruthy();
	} finally {
		vi.useRealTimers();
	}
});

// ── Part 2: F-M-Timer countdown ──────────────────────────────────────────────

test('context questions are untimed; the first skills question shows a countdown at its limit', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);

		// Q1 (Section 1, "About you") is NOT timed.
		expect(screen.getByText('Question 1 of 17')).toBeTruthy();
		expect(screen.queryByText('Time on this question')).toBeNull();

		// Answer Q1–Q4 (the four context questions) to reach Q5, the first skills question.
		for (let n = 1; n <= 4; n++) answerCurrent(container);

		// Q5 (Section 2) IS timed and its countdown starts at the configured limit (45s).
		expect(screen.getByText('Question 5 of 17')).toBeTruthy();
		expect(screen.getByText('Time on this question')).toBeTruthy();
		expect(screen.getByText(`${SKILLS_TIME_LIMIT_SEC.q5}s`)).toBeTruthy();
	} finally {
		vi.useRealTimers();
	}
});

test('when the countdown expires with no answer, the flow auto-advances to the next question', () => {
	vi.useFakeTimers();
	try {
		const { container } = render(<DiagnosticFlow />);
		for (let n = 1; n <= 4; n++) answerCurrent(container); // reach Q5

		expect(screen.getByText('Question 5 of 17')).toBeTruthy();

		// Let Q5's countdown run all the way out WITHOUT choosing an answer.
		act(() => {
			vi.advanceTimersByTime((SKILLS_TIME_LIMIT_SEC.q5 + 1) * 1000);
		});

		// It auto-advanced to Q6, which is itself timed.
		expect(screen.getByText('Question 6 of 17')).toBeTruthy();
		expect(screen.getByText('Time on this question')).toBeTruthy();
	} finally {
		vi.useRealTimers();
	}
});
