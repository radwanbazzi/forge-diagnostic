/**
 * adminApi is the only thing that talks to /api/admin/*. Four rules it must never break:
 *
 *  1. It sends ONLY the four whitelisted manual fields on a PATCH — a computed field
 *     (score, band, archetype) must be unexpressible from this UI.
 *  2. It never builds a broken wa.me link.
 *  3. A 401 is distinguishable from every other failure, so the UI can say "session
 *     expired" instead of "something went wrong".
 *  4. The dev-bypass headers exist only for a localhost page view.
 *
 * These run at jsdom's default origin (http://localhost:3000), i.e. the local-dev case.
 * The production case is proven separately in admin-prod-host.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AdminApiError,
	clearDevAuth,
	formatGap,
	getDevAuth,
	getLead,
	isLocalDevHost,
	listLeads,
	looksLocalOnly,
	patchLead,
	relativeTime,
	setDevAuth,
	shortProgram,
	waDigits,
	waLink,
} from '../src/lib/adminApi';

let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown) {
	return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
	clearDevAuth();
	fetchMock = vi.fn(() => ok({ leads: [], total: 0 }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearDevAuth();
});

/** The URL of call `i`. */
function urlOf(i = 0): string {
	return String(fetchMock.mock.calls[i][0]);
}
/** The merged headers of call `i`. */
function headersOf(i = 0): Record<string, string> {
	return ((fetchMock.mock.calls[i][1] as RequestInit)?.headers ?? {}) as Record<string, string>;
}

describe('the local-dev sign-in', () => {
	it('treats jsdom’s localhost origin as a dev host', () => {
		expect(isLocalDevHost()).toBe(true);
	});

	it('round-trips through sessionStorage', () => {
		setDevAuth({ secret: 's3cret', email: 'founder@example.com' });
		expect(getDevAuth()).toEqual({ secret: 's3cret', email: 'founder@example.com' });
		clearDevAuth();
		expect(getDevAuth()).toBeNull();
	});

	it('attaches the dev headers only once signed in', async () => {
		await listLeads();
		expect(headersOf(0)['X-Dev-Access-Secret']).toBeUndefined();

		setDevAuth({ secret: 's3cret', email: 'founder@example.com' });
		await listLeads();
		expect(headersOf(1)).toMatchObject({
			'X-Dev-Access-Secret': 's3cret',
			'X-Dev-Access-Email': 'founder@example.com',
		});
	});
});

describe('listLeads query building', () => {
	it('sends no query string when there are no filters', async () => {
		await listLeads();
		expect(urlOf()).toBe('/api/admin/leads');
	});

	it('asks for the unsent queue with result_sent=0', async () => {
		await listLeads({ result_sent: 0, limit: 100 });
		expect(urlOf()).toBe('/api/admin/leads?result_sent=0&limit=100');
	});

	it('passes the search term through as q', async () => {
		// URLSearchParams form-encodes a space as "+", which the Worker decodes back to a
		// space — so a phone number typed with spaces still reaches the phone-digit search.
		await listLeads({ q: '70 123 456' });
		expect(urlOf()).toBe('/api/admin/leads?q=70+123+456');
		expect(new URL(urlOf(), 'http://x').searchParams.get('q')).toBe('70 123 456');
	});

	it('drops empty values rather than sending a bare q=', async () => {
		await listLeads({ q: '', status: undefined });
		expect(urlOf()).toBe('/api/admin/leads');
	});
});

describe('failures', () => {
	it('reports a 401 as its own status so the UI can say the session expired', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 401 })));
		await expect(listLeads()).rejects.toMatchObject({ status: 401 });
	});

	it('carries the server error code on other failures', async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(new Response(JSON.stringify({ error: 'invalid_filter' }), { status: 400 })),
		);
		await expect(listLeads({ status: 'HOT' })).rejects.toThrow(/invalid_filter/);
	});

	it('turns an unreachable server into a friendly AdminApiError, not a raw TypeError', async () => {
		fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
		const err = await listLeads().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AdminApiError);
		expect((err as AdminApiError).status).toBe(0);
	});

	it('lets an abort propagate untouched (debounced search cancels in flight)', async () => {
		const ac = new AbortController();
		fetchMock.mockImplementation(() => Promise.reject(new DOMException('aborted', 'AbortError')));
		await expect(listLeads({}, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
	});
});

describe('patchLead writes only the manual fields', () => {
	beforeEach(() => {
		fetchMock.mockImplementation(() => ok({ id: 'x' }));
	});

	it('sends exactly the four whitelisted fields', async () => {
		await patchLead('abc', { result_sent: true, followup_status: 'Msg1 sent', outcome: 'Enrolled $80', notes: 'called' });
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({ result_sent: true, followup_status: 'Msg1 sent', outcome: 'Enrolled $80', notes: 'called' });
	});

	it('silently refuses to forward a computed field even if one is passed in', async () => {
		// The type system already forbids this; the cast proves the runtime guard too, so a
		// future refactor cannot start smuggling lead_score / overall_band into a PATCH.
		await patchLead('abc', { result_sent: true, lead_score: 11, overall_band: '1400-1500', q5: 'A) 15' } as never);
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({ result_sent: true });
	});

	it('sends a cleared note as null rather than dropping it', async () => {
		await patchLead('abc', { notes: null });
		const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
		expect(body).toEqual({ notes: null });
	});

	it('PATCHes the right lead', async () => {
		await patchLead('11111111-2222-3333-4444-555555555555', { result_sent: true });
		expect(urlOf()).toBe('/api/admin/leads/11111111-2222-3333-4444-555555555555');
		expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH');
	});

	it('getLead hits the single-lead route', async () => {
		await getLead('11111111-2222-3333-4444-555555555555');
		expect(urlOf()).toBe('/api/admin/leads/11111111-2222-3333-4444-555555555555');
	});
});

describe('the WhatsApp link', () => {
	it('strips formatting down to digits', () => {
		expect(waDigits('+961 70 12-34.56')).toBe('96170123456');
		expect(waDigits(null)).toBe('');
	});

	it('encodes the message so newlines and emoji survive', () => {
		const link = waLink('+961 70 123 456', 'Hi Lina!\nYour range: 1040-1200 📊');
		expect(link).toBe(`https://wa.me/96170123456?text=${encodeURIComponent('Hi Lina!\nYour range: 1040-1200 📊')}`);
		expect(link).not.toContain('\n');
	});

	it('returns null when the number holds no digits at all (never wa.me/undefined)', () => {
		expect(waLink('', 'msg')).toBeNull();
		expect(waLink(null, 'msg')).toBeNull();
		expect(waLink('not a number', 'msg')).toBeNull();
	});

	it('flags a local-only number, which wa.me cannot dial', () => {
		expect(looksLocalOnly('03 123 456')).toBe(true); // leading zero, Lebanese local
		expect(looksLocalOnly('70123456')).toBe(true); // 8 digits, no country code
		expect(looksLocalOnly('+961 70 123 456')).toBe(false); // full international
		expect(looksLocalOnly('')).toBe(false); // no digits is the other case entirely
	});
});

describe('display helpers', () => {
	it('formats the gap, including the "Not sure" null', () => {
		expect(formatGap(180)).toBe('+180');
		expect(formatGap(null)).toBe('—');
		expect(formatGap(-20)).toBe('-20');
	});

	it('shortens the programme name for the tight columns', () => {
		expect(shortProgram('$130 SAT Accelerator')).toBe('$130');
		expect(shortProgram('$80 SAT Essentials')).toBe('$80');
	});

	it('reads recent times the way a person would', () => {
		const now = Date.UTC(2026, 8, 11, 12, 0, 0);
		expect(relativeTime(now - 30_000, now)).toBe('just now');
		expect(relativeTime(now - 14 * 60_000, now)).toBe('14m ago');
		expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
	});
});
