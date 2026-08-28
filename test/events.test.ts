import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { events as eventsTable } from '../src/db/schema';
import { _resetRateLimits, checkRateLimit } from '../src/lib/rateLimit';

const URL = 'https://x/api/event';

function post(body: unknown, raw = false) {
	return SELF.fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });
}
function eventsFor(session_id: string) {
	return getDb(env).select().from(eventsTable).where(eq(eventsTable.session_id, session_id));
}

beforeEach(async () => {
	await getDb(env).delete(eventsTable);
});

describe('POST /api/event — fire-and-forget (US-7)', () => {
	it('accepts a valid event → 202 and inserts it', async () => {
		const res = await post({ session_id: 'ev-1', type: 'start' });
		expect(res.status).toBe(202);
		const rows = await eventsFor('ev-1');
		expect(rows).toHaveLength(1);
		expect(rows[0].type).toBe('start');
	});

	it('accepts advance with question_index + meta', async () => {
		const res = await post({ session_id: 'ev-2', type: 'advance', question_index: 7, meta: { from: 'q6' } });
		expect(res.status).toBe(202);
		const rows = await eventsFor('ev-2');
		expect(rows[0].question_index).toBe(7);
		expect(JSON.parse(rows[0].meta as string)).toEqual({ from: 'q6' });
	});

	it('accepts every event type', async () => {
		for (const type of ['start', 'advance', 'contact_reached', 'completed', 'whatsapp_clicked'] as const) {
			const res = await post({ session_id: 'ev-types', type, ...(type === 'advance' ? { question_index: 1 } : {}) });
			expect(res.status).toBe(202);
		}
		expect(await eventsFor('ev-types')).toHaveLength(5);
	});

	it('never 500s on malformed JSON → 400', async () => {
		const res = await post('{ not json', true);
		expect(res.status).toBe(400);
		expect(res.status).not.toBe(500);
	});

	it('never 500s on an invalid type → 400, nothing inserted', async () => {
		const res = await post({ session_id: 'ev-bad', type: 'nope' });
		expect(res.status).toBe(400);
		expect(res.status).not.toBe(500);
		expect(await eventsFor('ev-bad')).toHaveLength(0);
	});

	it('never 500s on a missing session_id → 400', async () => {
		const res = await post({ type: 'start' });
		expect(res.status).toBe(400);
		expect(res.status).not.toBe(500);
	});
});

describe('rate limiting (US-7 F7.1)', () => {
	it('checkRateLimit allows up to the limit, then blocks, then resets after the window', () => {
		_resetRateLimits();
		const key = 'k';
		expect(checkRateLimit(key, 1000, 3, 1000)).toBe(true); // 1
		expect(checkRateLimit(key, 1000, 3, 1000)).toBe(true); // 2
		expect(checkRateLimit(key, 1000, 3, 1000)).toBe(true); // 3
		expect(checkRateLimit(key, 1000, 3, 1000)).toBe(false); // 4 → blocked
		expect(checkRateLimit(key, 2001, 3, 1000)).toBe(true); // new window → allowed
	});

	it('the endpoint drops a flood with 429', async () => {
		let got429 = false;
		for (let i = 0; i < 65; i++) {
			const r = await post({ session_id: 'flood', type: 'start' });
			if (r.status === 429) {
				got429 = true;
				break;
			}
		}
		expect(got429).toBe(true);
	});
});
