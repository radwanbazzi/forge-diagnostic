/**
 * Frontend ⇄ backend submission contract (regression guard).
 *
 * The interactive flow (web/src/components/DiagnosticFlow.tsx) shows the student the
 * option strings from src/lib/questions.ts and POSTs the chosen one to
 * /api/diagnostic/submit, where src/lib/validation.ts checks it against the SAME
 * questions.ts option sets. If those two sides ever drift — an option the UI shows
 * that validation no longer accepts, or a field the frontend sends under a different
 * key — every real submission 400s and the student sees "Something went wrong".
 *
 * These tests fail loudly the moment that happens:
 *   1. EVERY option the UI can display for EVERY scored question is accepted by the
 *      request schema (no displayable option can ever be a 400).
 *   2. A full, realistically-shaped submission — assembled exactly the way the React
 *      component assembles it — returns 200, a real result_payload, and persists
 *      EXACTLY ONE lead row.
 */
import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { diagnostics } from '../src/db/schema';
import { ANSWER_OPTIONS, QUESTIONS, RESPONDENT_OPTIONS } from '../src/lib/questions';
import { submissionSchema } from '../src/lib/validation';

const SUBMIT_URL = 'https://example.com/api/diagnostic/submit';

// The choice questions the flow renders one-per-screen (sections 1–3) — exactly the
// set DiagnosticFlow.tsx collects answers for before the contact screen.
const CHOICE_QUESTIONS = QUESTIONS.filter((q) => q.section !== 4 && q.options);

/**
 * Assemble a submission the way DiagnosticFlow.tsx handleSubmit() does: one option
 * per scored question, plus the Section-4 contact screen. `pick` chooses which option.
 */
function browserSubmission(session_id: string, pick: (opts: readonly string[]) => string) {
	const answers: Record<string, string> = {};
	for (const q of CHOICE_QUESTIONS) answers[q.field] = pick(q.options!);
	return {
		session_id,
		completion_time_sec: 123,
		answers,
		contact: {
			first_name: 'Test',
			whatsapp: '+961 3 000 000',
			school: 'Test School',
			respondent_type: RESPONDENT_OPTIONS[0], // 'Student'
			consent: true,
		},
	};
}

describe('frontend ⇄ backend submission contract', () => {
	it('every option the UI can show for every scored question passes validation', () => {
		// If any displayed option is not in the schema's accepted set, this is the 400
		// the student would hit — surface exactly which question/option drifted.
		for (const q of CHOICE_QUESTIONS) {
			const accepted = ANSWER_OPTIONS[q.field as keyof typeof ANSWER_OPTIONS] as readonly string[];
			expect(accepted, `no ANSWER_OPTIONS entry for field "${q.field}"`).toBeTruthy();
			for (const opt of q.options!) {
				const body = browserSubmission(`contract-${q.field}`, (opts) => opts[0]);
				body.answers[q.field] = opt;
				const parsed = submissionSchema.safeParse(body);
				expect(parsed.success, `question ${q.n} (${q.field}) option "${opt}" was rejected by validation`).toBe(true);
			}
		}
	});

	it('a full browser-shaped submission → 200, real result, exactly one lead', async () => {
		const sid = 'contract-e2e';
		const res = await SELF.fetch(SUBMIT_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(browserSubmission(sid, (opts) => opts[0])),
		});
		expect(res.status).toBe(200);

		const json = (await res.json()) as { id: string; result_payload: { band: { range: string }; meta: { lead_status: string } } };
		expect(json.id).toBeTruthy();
		expect(json.result_payload.band.range).toMatch(/^\d+-\d+$/); // a real "low-high" band
		expect(json.result_payload.meta.lead_status).toBeTruthy();

		const rows = await getDb(env).select().from(diagnostics).where(eq(diagnostics.session_id, sid));
		expect(rows).toHaveLength(1); // exactly one lead saved
		expect(rows[0].id).toBe(json.id);
		expect(rows[0].consent).toBe(1);
	});
});
