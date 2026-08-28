import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics } from '../src/db/schema';
import { RAMI } from './fixtures';

// These match .dev.vars (loaded into the test worker env).
const ADMIN_EMAIL = 'founder@example.com';
const DEV_SECRET = 'local-dev-secret-change-me';
const auth = { 'X-Dev-Access-Email': ADMIN_EMAIL, 'X-Dev-Access-Secret': DEV_SECRET };

const T = 1_700_000_000_000; // fixed base timestamp for date-ordering/range tests

/** A complete, valid diagnostics row built from the Rami fixture; override any field. */
function makeLead(over: Partial<typeof diagnostics.$inferInsert> = {}) {
	const row = {
		id: crypto.randomUUID(),
		session_id: crypto.randomUUID(),
		created_at: T,
		...RAMI.answers,
		first_name: 'Seed',
		whatsapp: '+961 3 000 000',
		school: null,
		respondent_type: 'student' as const,
		consent: 1,
		...RAMI.expected,
		result_payload: JSON.stringify({
			band: { range: RAMI.expected.overall_band, confidence: RAMI.expected.confidence, sub: '' },
			profile: { archetype: RAMI.expected.archetype, statement: '', meaning: 'a test meaning' },
			top_fixes: ['Do the first fix'],
		}),
		...over,
	};
	return row as typeof diagnostics.$inferInsert;
}

async function seed(leads: Array<Partial<typeof diagnostics.$inferInsert>>) {
	const db = getDb(env);
	for (const l of leads) await db.insert(diagnostics).values(makeLead(l));
}

// Clean slate before every test regardless of storage isolation.
beforeEach(async () => {
	await getDb(env).delete(diagnostics);
});

describe('GET /api/admin/leads — auth (US-3)', () => {
	it('F3.1 no credentials → 401', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads')).status).toBe(401);
	});
	it('wrong secret → 401', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads', { headers: { 'X-Dev-Access-Email': ADMIN_EMAIL, 'X-Dev-Access-Secret': 'wrong' } });
		expect(res.status).toBe(401);
	});
	it('wrong email → 401', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads', { headers: { 'X-Dev-Access-Email': 'someone@else.com', 'X-Dev-Access-Secret': DEV_SECRET } });
		expect(res.status).toBe(401);
	});
});

describe('GET /api/admin/leads — list/filter/search/page', () => {
	it('F3.2 empty database → 200 with []', async () => {
		const res = await SELF.fetch('https://x/api/admin/leads', { headers: auth });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { leads: unknown[]; total: number };
		expect(body.leads).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('lists newest-first with computed fields', async () => {
		await seed([
			{ first_name: 'Cara', lead_status: 'COLD', recommended_program: '$80 SAT Essentials', created_at: T + 1000 },
			{ first_name: 'Alice', lead_status: 'HOT', recommended_program: '$130 SAT Accelerator', created_at: T + 3000 },
			{ first_name: 'Bob', lead_status: 'WARM', recommended_program: '$130 SAT Accelerator', created_at: T + 2000 },
		]);
		const res = await SELF.fetch('https://x/api/admin/leads', { headers: auth });
		const body = (await res.json()) as { leads: Array<{ first_name: string; lead_status: string }>; total: number };
		expect(body.total).toBe(3);
		expect(body.leads.map((l) => l.first_name)).toEqual(['Alice', 'Bob', 'Cara']);
		expect(body.leads[0].lead_status).toBe('HOT');
	});

	it('filters by status (case-insensitive)', async () => {
		await seed([{ first_name: 'Alice', lead_status: 'HOT' }, { first_name: 'Bob', lead_status: 'WARM' }]);
		const res = await SELF.fetch('https://x/api/admin/leads?status=hot', { headers: auth });
		const body = (await res.json()) as { total: number; leads: Array<{ first_name: string }> };
		expect(body.total).toBe(1);
		expect(body.leads[0].first_name).toBe('Alice');
	});

	it('filters by program shorthand (130)', async () => {
		await seed([{ first_name: 'Alice', recommended_program: '$130 SAT Accelerator' }, { first_name: 'Cara', recommended_program: '$80 SAT Essentials' }]);
		const res = await SELF.fetch('https://x/api/admin/leads?program=130', { headers: auth });
		const body = (await res.json()) as { total: number; leads: Array<{ first_name: string }> };
		expect(body.total).toBe(1);
		expect(body.leads[0].first_name).toBe('Alice');
	});

	it('searches by name (q)', async () => {
		await seed([{ first_name: 'Alice' }, { first_name: 'Alina' }, { first_name: 'Bob' }]);
		const res = await SELF.fetch('https://x/api/admin/leads?q=Ali', { headers: auth });
		expect(((await res.json()) as { total: number }).total).toBe(2);
	});

	it('filters by date range (from/to)', async () => {
		await seed([{ first_name: 'Old', created_at: T }, { first_name: 'Mid', created_at: T + 5000 }, { first_name: 'New', created_at: T + 10000 }]);
		const res = await SELF.fetch(`https://x/api/admin/leads?from=${T + 1000}&to=${T + 6000}`, { headers: auth });
		const body = (await res.json()) as { total: number; leads: Array<{ first_name: string }> };
		expect(body.total).toBe(1);
		expect(body.leads[0].first_name).toBe('Mid');
	});

	it('pages with limit/offset', async () => {
		await seed(Array.from({ length: 5 }, (_, i) => ({ first_name: `P${i}`, created_at: T + i * 1000 })));
		const res = await SELF.fetch('https://x/api/admin/leads?limit=2&offset=1', { headers: auth });
		const body = (await res.json()) as { total: number; leads: unknown[] };
		expect(body.total).toBe(5);
		expect(body.leads).toHaveLength(2);
	});

	it('F3.3 no-match filter → 200 with []', async () => {
		await seed([{ first_name: 'Alice', lead_status: 'HOT' }]);
		const res = await SELF.fetch('https://x/api/admin/leads?status=COLD', { headers: auth });
		const body = (await res.json()) as { leads: unknown[]; total: number };
		expect(body.leads).toEqual([]);
		expect(body.total).toBe(0);
	});

	it('F3.4 invalid status → 400', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads?status=PURPLE', { headers: auth })).status).toBe(400);
	});
	it('F3.4 invalid limit → 400', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads?limit=0', { headers: auth })).status).toBe(400);
	});
	it('F3.4 invalid from date → 400', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads?from=not-a-date', { headers: auth })).status).toBe(400);
	});
});

describe('GET /api/admin/leads/:id — detail (US-4)', () => {
	it('F4.3 no credentials → 401', async () => {
		expect((await SELF.fetch(`https://x/api/admin/leads/${crypto.randomUUID()}`)).status).toBe(401);
	});

	it('returns full row + parsed result_payload + whatsapp_message', async () => {
		const id = crypto.randomUUID();
		await seed([{ id, first_name: 'Detail' }]);
		const res = await SELF.fetch(`https://x/api/admin/leads/${id}`, { headers: auth });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			id: string;
			first_name: string;
			target_score: string;
			result_payload: { band: { range: string } };
			whatsapp_message: string;
		};
		expect(body.id).toBe(id);
		expect(body.first_name).toBe('Detail');
		expect(body.target_score).toBe(RAMI.answers.target_score); // full row incl. answers
		expect(body.result_payload.band.range).toBe(RAMI.expected.overall_band); // parsed object, not a string
		expect(body.whatsapp_message).toContain('Detail');
		expect(body.whatsapp_message).not.toContain('undefined');
		expect(body.whatsapp_message).not.toMatch(/\[[a-z_]+\]/);
	});

	it('F4.2 malformed id → 400', async () => {
		expect((await SELF.fetch('https://x/api/admin/leads/not-a-uuid', { headers: auth })).status).toBe(400);
	});
	it('F4.1 unknown id → 404', async () => {
		expect((await SELF.fetch(`https://x/api/admin/leads/${crypto.randomUUID()}`, { headers: auth })).status).toBe(404);
	});
});
