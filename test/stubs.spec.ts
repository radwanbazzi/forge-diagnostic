import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Contract-first (BACKEND_SPEC §7): routes not yet in their milestone must
// return 501 Not Implemented. This locks that in until each is built (B3–B6).
describe('unimplemented routes return 501', () => {
	const cases: Array<{ method: string; path: string }> = [
		{ method: 'POST', path: '/api/diagnostic/submit' },
		{ method: 'GET', path: '/api/admin/leads' },
		{ method: 'GET', path: '/api/admin/leads/some-id' },
		{ method: 'PATCH', path: '/api/admin/leads/some-id' },
		{ method: 'GET', path: '/api/admin/analytics' },
		{ method: 'POST', path: '/api/event' },
	];

	for (const { method, path } of cases) {
		it(`${method} ${path} -> 501`, async () => {
			const res = await SELF.fetch(`https://example.com${path}`, { method });
			expect(res.status).toBe(501);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe('not_implemented');
		});
	}
});
