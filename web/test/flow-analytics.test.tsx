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

		const back = container.querySelector('.fd-back');
		if (!back) throw new Error('no back control on the question screen');
		fireEvent.click(back);
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
