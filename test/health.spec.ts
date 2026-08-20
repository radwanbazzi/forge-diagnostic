import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
	it('returns 200 with { ok: true, time }', async () => {
		const res = await SELF.fetch('https://example.com/api/health');
		expect(res.status).toBe(200);

		const body = (await res.json()) as { ok: boolean; time: string };
		expect(body.ok).toBe(true);
		expect(typeof body.time).toBe('string');
		// `time` is a valid ISO-8601 timestamp
		expect(Number.isNaN(Date.parse(body.time))).toBe(false);
	});

	it('404s an unknown /api route', async () => {
		const res = await SELF.fetch('https://example.com/api/does-not-exist');
		expect(res.status).toBe(404);
	});
});
