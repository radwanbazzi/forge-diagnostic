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
