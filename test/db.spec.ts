import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics, events } from '../src/db/schema';

// Proves B1's Definition of Done: both tables exist locally and a row round-trips.
describe('D1 schema round-trip', () => {
	it('saves and reads back a diagnostics (lead) row', async () => {
		const db = getDb(env);
		const id = crypto.randomUUID();

		await db.insert(diagnostics).values({
			id,
			session_id: 'sess-roundtrip',
			// answers
			target_score: '1350-1449',
			grade: 'Grade 12',
			test_date: 'Within 8 weeks',
			sat_history: 'Official SAT: 1100-1299',
			q5: 'C) 300',
			q6: 'B) option',
			q7: 'B) option',
			q8: 'B) option',
			q9: 'B) option',
			q10: 'B) option',
			q11: 'A) option',
			q12: 'B) option',
			hours_per_week: '5-8 hours',
			timing: 'I finish right on time',
			review_mistakes: 'Sometimes',
			prep_status: 'On my own',
			worried_about: 'Math',
			// contact
			first_name: 'Test',
			whatsapp: '9613111111',
			school: 'Test School',
			respondent_type: 'student',
			consent: 1,
			// computed snapshot
			math_raw: 5,
			rw_raw: 6,
			overall_band: '1150-1320',
			confidence: 'Moderate',
			archetype: 'Plateaued Retaker',
			target_num: 1400,
			current_mid: 1235,
			gap: 165,
			timeline_verdict: 'Aggressive',
			recommended_program: '$130 SAT Accelerator',
			lead_score: 11,
			lead_status: 'HOT',
			result_payload: JSON.stringify({ overall_band: '1150-1320' }),
		});

		const [row] = await db.select().from(diagnostics).where(eq(diagnostics.id, id));
		expect(row).toBeDefined();
		expect(row.session_id).toBe('sess-roundtrip');
		expect(row.lead_status).toBe('HOT');
		expect(row.gap).toBe(165);
		// created_at auto-filled with a unix-ms timestamp
		expect(typeof row.created_at).toBe('number');
		expect(row.created_at).toBeGreaterThan(0);
		// admin defaults applied
		expect(row.result_sent).toBe(0);
		expect(row.followup_status).toBe('None');
		expect(row.outcome).toBe('-');
		// nullable field stays null when omitted
		expect(row.notes).toBeNull();
	});

	it('saves and reads back an events row', async () => {
		const db = getDb(env);
		const id = crypto.randomUUID();

		await db.insert(events).values({
			id,
			session_id: 'sess-roundtrip',
			type: 'advance',
			question_index: 5,
			meta: JSON.stringify({ from: 'q4' }),
		});

		const [row] = await db.select().from(events).where(eq(events.id, id));
		expect(row).toBeDefined();
		expect(row.type).toBe('advance');
		expect(row.question_index).toBe(5);
	});
});
