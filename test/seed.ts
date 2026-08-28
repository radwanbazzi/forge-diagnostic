import { diagnostics } from '../src/db/schema';
import { RAMI } from './fixtures';

/** A complete, valid `diagnostics` row built from the Rami fixture; override any field. */
export function makeLead(over: Partial<typeof diagnostics.$inferInsert> = {}) {
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
