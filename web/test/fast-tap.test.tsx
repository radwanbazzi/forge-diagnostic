/**
 * Regression guard for the "submit 400" — the real one.
 *
 * The diagnostic auto-advances 160ms after each tap. The original code scheduled that
 * advance on EVERY tap, so tapping faster than 160ms (a rushing student, or a mobile
 * double-tap) queued two advances and jumped two questions at once — the skipped question
 * was never answered, and the submission 400'd because `answers` was incomplete.
 *
 * These tests simulate fast tapping with fake timers. If the debounce/lock in
 * DiagnosticFlow ever regresses, a tap will skip a question and the "Question N of 17"
 * assertions below fail — so the build fails instead of shipping a broken flow.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import DiagnosticFlow from '../src/components/DiagnosticFlow';

const ADVANCE_MS = 160;

afterEach(cleanup);

/** The first answer option on the current question screen. */
function firstOption(container: HTMLElement): HTMLElement {
	const btn = container.querySelector('.fd-options button');
	if (!btn) throw new Error('no answer option rendered on the current screen');
	return btn as HTMLElement;
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
