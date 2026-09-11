/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://forge-diagnostic.example.com/admin" }
 *
 * The local-dev admin bypass must be IMPOSSIBLE from a deployed page.
 *
 * There are three gates (see adminApi.isLocalDevHost). Two are server-side and already
 * covered by the backend suite — DEV_ADMIN_SECRET is never deployed, and the bypass is
 * force-disabled once ACCESS_AUD is set. This file proves the CLIENT gate: served from a
 * real domain instead of localhost, the dashboard cannot store a dev credential and never
 * puts the X-Dev-Access-* headers on a request, even when sessionStorage has been primed
 * with one by hand.
 *
 * The docblock above re-points jsdom at a public origin for this file only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevAuth, isLocalDevHost, listLeads, patchLead, setDevAuth } from '../src/lib/adminApi';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	sessionStorage.clear();
	fetchMock = vi.fn(() =>
		Promise.resolve(new Response(JSON.stringify({ leads: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })),
	);
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

function headersOf(i = 0): Record<string, string> {
	return ((fetchMock.mock.calls[i][1] as RequestInit)?.headers ?? {}) as Record<string, string>;
}

function hasDevHeaders(h: Record<string, string>): boolean {
	return Object.keys(h).some((k) => k.toLowerCase().startsWith('x-dev-access'));
}

describe('on a production host', () => {
	it('is not a dev host', () => {
		expect(location.hostname).toBe('forge-diagnostic.example.com');
		expect(isLocalDevHost()).toBe(false);
	});

	it('refuses to store a dev credential', () => {
		setDevAuth({ secret: 's3cret', email: 'founder@example.com' });
		expect(sessionStorage.getItem('forge.admin.devAuth')).toBeNull();
		expect(getDevAuth()).toBeNull();
	});

	it('ignores a dev credential planted in sessionStorage by hand', () => {
		sessionStorage.setItem('forge.admin.devAuth', JSON.stringify({ secret: 's3cret', email: 'founder@example.com' }));
		expect(getDevAuth()).toBeNull();
	});

	it('sends no dev headers on a read, even with one planted', async () => {
		sessionStorage.setItem('forge.admin.devAuth', JSON.stringify({ secret: 's3cret', email: 'founder@example.com' }));
		await listLeads({ result_sent: 0 });
		expect(hasDevHeaders(headersOf(0))).toBe(false);
	});

	it('sends no dev headers on a write, even with one planted', async () => {
		sessionStorage.setItem('forge.admin.devAuth', JSON.stringify({ secret: 's3cret', email: 'founder@example.com' }));
		await patchLead('11111111-2222-3333-4444-555555555555', { result_sent: true });
		expect(hasDevHeaders(headersOf(0))).toBe(false);
		// The real request headers are still intact — only the bypass is missing.
		expect(headersOf(0)['content-type']).toBe('application/json');
	});
});
