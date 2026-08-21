import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics } from '../src/db/schema';
import { GOLDENS, RAMI, submissionBody } from './fixtures';

const URL = 'https://example.com/api/diagnostic/submit';

function post(body: unknown, raw = false) {
	return SELF.fetch(URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: raw ? (body as string) : JSON.stringify(body),
	});
}

function rowsFor(session_id: string) {
	return getDb(env).select().from(diagnostics).where(eq(diagnostics.session_id, session_id));
}

describe('POST /api/diagnostic/submit — happy path', () => {
	for (const [name, g] of Object.entries(GOLDENS)) {
		it(`${name}: 200, returns result_payload, persists exactly one correct row`, async () => {
			const sid = `sess-${name}`;
			const res = await post(submissionBody(g, sid));
			expect(res.status).toBe(200);

			const json = (await res.json()) as { id: string; result_payload: any };
			expect(json.id).toBeTruthy();
			expect(json.result_payload.band.range).toBe(g.expected.overall_band);
			expect(json.result_payload.meta.lead_status).toBe(g.expected.lead_status);

			// exactly one row, with the computed snapshot matching the golden
			const rows = await rowsFor(sid);
			expect(rows).toHaveLength(1);
			const row = rows[0];
			expect(row.id).toBe(json.id);
			expect(row.overall_band).toBe(g.expected.overall_band);
			expect(row.archetype).toBe(g.expected.archetype);
			expect(row.lead_score).toBe(g.expected.lead_score);
			expect(row.lead_status).toBe(g.expected.lead_status);
			expect(row.gap).toBe(g.expected.gap);
			expect(row.consent).toBe(1);
			expect(row.respondent_type).toBe('student');
			// result_payload persisted equals what we returned
			expect(JSON.parse(row.result_payload).band.range).toBe(g.expected.overall_band);
		});
	}

	it('result_payload never contains unfilled [brackets] or "undefined"', async () => {
		const res = await post(submissionBody(RAMI, 'sess-nobrackets'));
		const json = (await res.json()) as { result_payload: unknown };
		const s = JSON.stringify(json.result_payload);
		expect(s).not.toContain('undefined');
		expect(s).not.toMatch(/\[[a-z_]+\]/); // no leftover [snake_case] template slots
	});

	it('builds a wa.me CTA link from the WhatsApp number', async () => {
		const res = await post(submissionBody(RAMI, 'sess-cta'));
		const json = (await res.json()) as { result_payload: { cta: { whatsapp_url: string | null } } };
		expect(json.result_payload.cta.whatsapp_url).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
		expect(json.result_payload.cta.whatsapp_url).not.toContain('undefined');
	});
});

describe('POST /api/diagnostic/submit — US-1 failure cases (nothing persisted)', () => {
	it('F1.1 missing required field → 400', async () => {
		const body: any = submissionBody(RAMI, 'sess-f11');
		delete body.answers.target_score;
		const res = await post(body);
		expect(res.status).toBe(400);
		expect(await rowsFor('sess-f11')).toHaveLength(0);
	});

	it('F1.2 consent not true → 400 "consent required"', async () => {
		const body: any = submissionBody(RAMI, 'sess-f12');
		body.contact.consent = false;
		const res = await post(body);
		expect(res.status).toBe(400);
		expect((await res.json() as { message?: string }).message).toBe('consent required');
		expect(await rowsFor('sess-f12')).toHaveLength(0);
	});

	it('F1.3 malformed JSON → 400', async () => {
		const res = await post('{ this is not valid json', true);
		expect(res.status).toBe(400);
	});

	it('F1.4 unknown answer option → 400', async () => {
		const body: any = submissionBody(RAMI, 'sess-f14');
		body.answers.q5 = 'Z) not a real option';
		const res = await post(body);
		expect(res.status).toBe(400);
		expect(await rowsFor('sess-f14')).toHaveLength(0);
	});

	it('F1.6 duplicate session_id → dedupes to a single lead (no duplicate)', async () => {
		const first = await post(submissionBody(RAMI, 'sess-dupe'));
		expect(first.status).toBe(200);
		const second = await post(submissionBody(RAMI, 'sess-dupe'));
		expect(second.status).toBe(200);
		expect(await rowsFor('sess-dupe')).toHaveLength(1);
	});

	it('F1.7 extra/unknown fields → stripped, submission still succeeds', async () => {
		const body: any = submissionBody(RAMI, 'sess-f17');
		body.answers.hacker_field = 'ignore me';
		body.contact.is_admin = true;
		body.top_level_junk = 123;
		const res = await post(body);
		expect(res.status).toBe(200);
		expect(await rowsFor('sess-f17')).toHaveLength(1);
	});
});
