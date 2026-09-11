import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics, events as eventsTable } from '../src/db/schema';
import { makeLead } from './seed';

const auth = { 'X-Dev-Access-Email': 'founder@example.com', 'X-Dev-Access-Secret': 'local-dev-secret-change-me' };

function ev(session_id: string, type: string, question_index?: number) {
	return {
		id: crypto.randomUUID(),
		session_id,
		created_at: 1_700_000_000_000,
		type: type as 'start' | 'advance' | 'contact_reached' | 'completed' | 'whatsapp_clicked',
		question_index: question_index ?? null,
		meta: null,
	};
}

beforeEach(async () => {
	await getDb(env).delete(eventsTable);
	await getDb(env).delete(diagnostics);
});

async function seedAll() {
	const db = getDb(env);
	await db.insert(eventsTable).values([
		ev('s1', 'start'),
		ev('s2', 'start'),
		ev('s3', 'start'), // started = 3
		ev('s1', 'advance', 5),
		ev('s1', 'advance', 10),
		ev('s2', 'advance', 5),
		ev('s3', 'advance', 5),
		ev('s3', 'advance', 10),
		ev('s3', 'advance', 20), // funnel: q5→3, q10→2, q20→1
		ev('s1', 'contact_reached'),
		ev('s3', 'contact_reached'),
		ev('s1', 'completed'),
		ev('s3', 'completed'), // completed = 2
		ev('s1', 'whatsapp_clicked'), // whatsapp = 1
	]);
	// One row per insert: a lead has 44 columns and D1 caps bound parameters per statement.
	for (const lead of [
		makeLead({ lead_status: 'HOT', outcome: 'Enrolled $130' }),
		makeLead({ lead_status: 'HOT', outcome: 'Enrolled $80' }),
		makeLead({ lead_status: 'WARM', outcome: '-' }),
		makeLead({ lead_status: 'COLD', outcome: '-' }),
	]) {
		await db.insert(diagnostics).values(lead);
	}
}

describe('GET /api/admin/analytics (US-7)', () => {
	it('is 401 when unauthenticated', async () => {
		expect((await SELF.fetch('https://x/api/admin/analytics')).status).toBe(401);
	});

	it('computes the funnel metrics correctly on seeded data', async () => {
		await seedAll();
		const res = await SELF.fetch('https://x/api/admin/analytics', { headers: auth });
		expect(res.status).toBe(200);
		const d = (await res.json()) as any;

		expect(d.started).toBe(3);
		expect(d.completed).toBe(2);
		// The contact gate (F-M3b): s1 and s3 reached it, s2 quit inside the questions.
		expect(d.contact_reached).toBe(2);
		expect(d.completion_rate).toBe(0.6667); // 2/3
		expect(d.funnel_by_question).toEqual([
			{ question_index: 5, count: 3 },
			{ question_index: 10, count: 2 },
			{ question_index: 20, count: 1 },
		]);
		expect(d.status_mix).toEqual({ HOT: 2, WARM: 1, COLD: 1 });
		expect(d.whatsapp_click_rate).toBe(0.5); // 1 clicked / 2 completed
		expect(d.enrollment_rate).toBe(0.5); // 2 enrolled / 4 leads
	});

	it('returns zeros (not an error) with no data', async () => {
		const res = await SELF.fetch('https://x/api/admin/analytics', { headers: auth });
		expect(res.status).toBe(200);
		const d = (await res.json()) as any;
		expect(d.started).toBe(0);
		expect(d.contact_reached).toBe(0);
		expect(d.completion_rate).toBe(0);
		expect(d.funnel_by_question).toEqual([]);
		expect(d.status_mix).toEqual({ HOT: 0, WARM: 0, COLD: 0 });
		expect(d.enrollment_rate).toBe(0);
	});
});

describe('GET /api/admin/analytics — audience mix (B8)', () => {
	async function analytics() {
		const res = await SELF.fetch('https://x/api/admin/analytics', { headers: auth });
		expect(res.status).toBe(200);
		return (await res.json()) as {
			archetype_mix: Record<string, number>;
			program_mix: Record<string, number>;
			totals: { leads: number };
		};
	}

	it('counts leads by archetype and by recommended programme', async () => {
		const db = getDb(env);
		for (const lead of [
			makeLead({ archetype: 'Time-Pressured', recommended_program: '$130 SAT Accelerator' }),
			makeLead({ archetype: 'Time-Pressured', recommended_program: '$130 SAT Accelerator' }),
			makeLead({ archetype: 'Untested Unknown', recommended_program: '$80 SAT Essentials' }),
		]) {
			await db.insert(diagnostics).values(lead);
		}

		const body = await analytics();
		expect(body.archetype_mix['Time-Pressured']).toBe(2);
		expect(body.archetype_mix['Untested Unknown']).toBe(1);
		expect(body.program_mix['$130 SAT Accelerator']).toBe(2);
		expect(body.program_mix['$80 SAT Essentials']).toBe(1);
	});

	it('the mixes sum to the total lead count', async () => {
		const db = getDb(env);
		for (const lead of [makeLead({ archetype: 'Plateaued Retaker' }), makeLead({ archetype: 'Shaky Grammarian' })]) {
			await db.insert(diagnostics).values(lead);
		}
		const body = await analytics();
		const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
		expect(sum(body.archetype_mix)).toBe(body.totals.leads);
		expect(sum(body.program_mix)).toBe(body.totals.leads);
	});

	it('returns empty mixes on an empty database rather than failing', async () => {
		const body = await analytics();
		expect(body.archetype_mix).toEqual({});
		expect(body.program_mix).toEqual({});
	});

	it('is still 401 without credentials', async () => {
		expect((await SELF.fetch('https://x/api/admin/analytics')).status).toBe(401);
	});
});
