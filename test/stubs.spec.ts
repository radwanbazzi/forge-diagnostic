import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Contract-first (BACKEND_SPEC §7): routes not yet in their milestone return 501.
// (The admin stubs are now behind auth — see admin.test.ts for their 401/501 behavior.)
describe('unimplemented public routes return 501', () => {
	it('POST /api/event -> 501', async () => {
		const res = await SELF.fetch('https://example.com/api/event', { method: 'POST' });
		expect(res.status).toBe(501);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('not_implemented');
	});
});
