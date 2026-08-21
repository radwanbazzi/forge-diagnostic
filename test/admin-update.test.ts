import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics } from '../src/db/schema';
import { RAMI } from './fixtures';

const auth = { 'X-Dev-Access-Email': 'founder@example.com', 'X-Dev-Access-Secret': 'local-dev-secret-change-me' };
const jsonAuth = { ...auth, 'content-type': 'application/json' };

/** A complete, valid diagnostics row from the Rami fixture; override any field. */
function makeLead(over: Partial<typeof diagnostics.$inferInsert> = {}) {
	const row = {
		id: crypto.randomUUID(),
		session_id: crypto.randomUUID(),
		created_at: 1_700_000_000_000,
		...RAMI.answers,
		first_name: 'Seed',
		whatsapp: '+961 3 000 000',
		school: null,
		respondent_type: 'student' as const,
		consent: 1,
		...RAMI.expected,
		result_payload: JSON.stringify({ band: { range: RAMI.expected.overall_band } }),
		...over,
	};
	return row as typeof diagnostics.$inferInsert;
}

async function seedOne(over: Partial<typeof diagnostics.$inferInsert> = {}) {
	const id = crypto.randomUUID();
	await getDb(env).insert(diagnostics).values(makeLead({ id, ...over }));
	return id;
}

function readLead(id: string) {
	return getDb(env).select().from(diagnostics).where(eq(diagnostics.id, id)).limit(1);
}

function patch(id: string, body: unknown, withAuth = true) {
	return SELF.fetch(`https://x/api/admin/leads/${id}`, {
		method: 'PATCH',
		headers: withAuth ? jsonAuth : { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

beforeEach(async () => {
	await getDb(env).delete(diagnostics);
});

describe('PATCH /api/admin/leads/:id — manual fields persist', () => {
	it('updates followup_status', async () => {
		const id = await seedOne();
		expect((await patch(id, { followup_status: 'Msg1 sent' })).status).toBe(200);
		expect((await readLead(id))[0].followup_status).toBe('Msg1 sent');
	});

	it('sets outcome', async () => {
		const id = await seedOne();
		expect((await patch(id, { outcome: 'Enrolled $130' })).status).toBe(200);
		expect((await readLead(id))[0].outcome).toBe('Enrolled $130');
	});

	it('sets result_sent (boolean stored as 0/1)', async () => {
		const id = await seedOne();
		expect((await patch(id, { result_sent: true })).status).toBe(200);
		expect((await readLead(id))[0].result_sent).toBe(1);
		expect((await patch(id, { result_sent: false })).status).toBe(200);
		expect((await readLead(id))[0].result_sent).toBe(0);
	});

	it('adds a note', async () => {
		const id = await seedOne();
		expect((await patch(id, { notes: 'Called, will reply tomorrow.' })).status).toBe(200);
		expect((await readLead(id))[0].notes).toBe('Called, will reply tomorrow.');
	});

	it('updates several fields at once and returns the updated row', async () => {
		const id = await seedOne();
		const res = await patch(id, { followup_status: 'Replied', outcome: 'Lost', notes: 'No budget this year.' });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id: string; followup_status: string; outcome: string; notes: string; result_payload: unknown };
		expect(body.id).toBe(id);
		expect(body.followup_status).toBe('Replied');
		expect(body.outcome).toBe('Lost');
		expect(body.notes).toBe('No budget this year.');
		expect(typeof body.result_payload).toBe('object'); // returned row has result_payload parsed
	});
});

describe('PATCH — whitelist enforcement (F5.1): forbidden fields rejected, row unchanged', () => {
	it('rejects a computed field (lead_score) and changes nothing', async () => {
		const id = await seedOne();
		expect((await patch(id, { lead_score: 3 })).status).toBe(400);
		expect((await readLead(id))[0].lead_score).toBe(RAMI.expected.lead_score);
	});

	it('rejects a computed field (archetype)', async () => {
		const id = await seedOne();
		expect((await patch(id, { archetype: 'Time-Pressured' })).status).toBe(400);
		expect((await readLead(id))[0].archetype).toBe(RAMI.expected.archetype);
	});

	it('rejects an answer field (target_score)', async () => {
		const id = await seedOne();
		expect((await patch(id, { target_score: '1450+' })).status).toBe(400);
		expect((await readLead(id))[0].target_score).toBe(RAMI.answers.target_score);
	});

	it('rejects an unknown field', async () => {
		const id = await seedOne();
		expect((await patch(id, { is_admin: true })).status).toBe(400);
	});

	it('rejects a valid field mixed with a forbidden one — nothing is applied', async () => {
		const id = await seedOne();
		expect((await patch(id, { followup_status: 'Replied', lead_score: 0 })).status).toBe(400);
		const row = (await readLead(id))[0];
		expect(row.followup_status).toBe('None'); // the valid field was NOT applied
		expect(row.lead_score).toBe(RAMI.expected.lead_score);
	});

	it('rejects an empty body', async () => {
		const id = await seedOne();
		expect((await patch(id, {})).status).toBe(400);
	});
});

describe('PATCH — enum, id, and auth failures', () => {
	it('F5.2 invalid followup_status → 400', async () => {
		const id = await seedOne();
		expect((await patch(id, { followup_status: 'Whatever' })).status).toBe(400);
	});

	it('F5.2 invalid outcome → 400', async () => {
		const id = await seedOne();
		expect((await patch(id, { outcome: 'Enrolled $999' })).status).toBe(400);
	});

	it('malformed id → 400', async () => {
		expect((await patch('not-a-uuid', { notes: 'x' })).status).toBe(400);
	});

	it('F5.3 unknown id → 404', async () => {
		expect((await patch(crypto.randomUUID(), { notes: 'x' })).status).toBe(404);
	});

	it('F5.4 unauthenticated → 401', async () => {
		const id = await seedOne();
		expect((await patch(id, { notes: 'x' }, false)).status).toBe(401);
	});
});
