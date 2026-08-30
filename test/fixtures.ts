import type { Answers, Computed } from '../src/types';

/**
 * The three golden cases (PRD §17), expressed with the EXACT locked option strings
 * from Tab ③ (en-dashes and all). Shared by scoring.test.ts and submit.test.ts so
 * both prove the same inputs against the same expected outputs.
 */
export interface GoldenContact {
	first_name: string;
	whatsapp: string;
	school?: string;
	respondent_type: 'Student' | 'Parent';
}

export interface Golden {
	answers: Answers;
	contact: GoldenContact;
	expected: Computed;
}

export const RAMI: Golden = {
	answers: {
		target_score: '1350–1449',
		grade: 'Grade 12',
		test_date: 'Within 8 weeks',
		sat_history: 'Official SAT — 1100–1299',
		q5: 'C) 300', // ✓ math 1
		q6: 'B) In addition', // ✓ rw 1
		q7: 'B) 4', // ✓ math 2
		q8: 'A) nostalgia', // ✗
		q9: 'B) 96%', // ✓ math 2
		q10: 'B) library; only', // ✓ rw 2
		q11: 'C) 15', // ✗ (correct A)
		q12: 'B) Food may have been prepared or eaten outside the walled area.', // ✓ rw 3
		hours_per_week: '5–8',
		timing: 'Finish right on time',
		review_mistakes: 'Sometimes',
		prep_status: 'On my own',
		worried_about: 'Math',
	},
	contact: { first_name: 'Rami', whatsapp: '+961 3 111 111', school: 'International College', respondent_type: 'Student' },
	expected: {
		math_raw: 5,
		rw_raw: 6,
		overall_band: '1040-1200', // Official 1100–1299 override (§7.3, lowered)
		confidence: 'Moderate',
		archetype: 'Plateaued Retaker',
		target_num: 1400,
		current_mid: 1120, // midpoint of 1040-1200
		gap: 280, // 1400 - 1120
		timeline_verdict: 'Aggressive',
		recommended_program: '$130 SAT Accelerator',
		lead_score: 11, // gap 280 ≥150 → gap sub-score 3 (unchanged)
		lead_status: 'HOT',
	},
};

export const LINA: Golden = {
	answers: {
		target_score: '1250–1349',
		grade: 'Grade 11',
		test_date: '4–6 months',
		sat_history: 'Practice only — 1100–1299',
		q5: 'C) 300', // ✓ math 1
		q6: 'B) In addition', // ✓ rw 1
		q7: 'B) 4', // ✓ math 2
		q8: 'A) nostalgia', // ✗
		q9: 'A) 100%', // ✗ (correct B)
		q10: 'B) library; only', // ✓ rw 2
		q11: 'A) 12', // ✓ math 3
		q12: 'B) Food may have been prepared or eaten outside the walled area.', // ✓ rw 3
		hours_per_week: '2–4',
		timing: 'Run out of time and rush or guess the last questions',
		review_mistakes: 'Rarely',
		prep_status: 'Through my school',
		worried_about: 'Reading',
	},
	contact: { first_name: 'Lina', whatsapp: '+961 3 222 222', respondent_type: 'Student' },
	expected: {
		math_raw: 6,
		rw_raw: 6,
		overall_band: '960-1120', // Practice 1100–1299 override (§7.3, lowered)
		confidence: 'Low-Moderate',
		archetype: 'Time-Pressured',
		target_num: 1300,
		current_mid: 1040, // midpoint of 960-1120
		gap: 260, // 1300 - 1040 (was 90 — the lowered band widened the gap)
		timeline_verdict: 'Comfortable',
		recommended_program: '$130 SAT Accelerator',
		lead_score: 7.5, // gap 260 now ≥150 → gap sub-score 3 (was 2 at gap 90) → +1
		lead_status: 'WARM',
	},
};

export const KARIM: Golden = {
	answers: {
		target_score: 'Not sure yet',
		grade: 'Grade 10',
		test_date: 'No date set',
		sat_history: 'Never taken one',
		q5: 'A) 15', // ✗
		q6: 'A) Nevertheless', // ✗
		q7: 'A) 3', // ✗
		q8: 'B) self-reproach', // ✓ rw 2
		q9: 'B) 96%', // ✓ math 2
		q10: 'B) library; only', // ✓ rw 2
		q11: 'B) 9', // ✗ (correct A)
		q12: 'A) The inhabitants did not eat the grain they grew.', // ✗ (correct B) → Q12 wrong, so NOT Shaky Grammarian
		hours_per_week: 'Less than 2',
		timing: "I've never done a timed section",
		review_mistakes: "I don't do practice questions",
		prep_status: 'Not really preparing yet',
		worried_about: 'Honestly, all of it',
	},
	contact: { first_name: 'Karim', whatsapp: '+961 3 333 333', respondent_type: 'Student' },
	expected: {
		math_raw: 2,
		rw_raw: 4,
		overall_band: '650-790', // never taken → estimate: raw2 [270,340] + raw4 [380,450] (§7.2, lowered)
		confidence: 'Low',
		archetype: 'Untested Unknown',
		target_num: 0,
		current_mid: 720, // midpoint of 650-790
		gap: null,
		timeline_verdict: 'Early / lots of runway',
		recommended_program: '$80 SAT Essentials',
		lead_score: 4,
		lead_status: 'COLD',
	},
};

export const GOLDENS: Record<string, Golden> = { Rami: RAMI, Lina: LINA, Karim: KARIM };

/**
 * Build a POST /api/diagnostic/submit body from a golden (adds session_id + consent).
 * Returns a fresh copy of `answers` so tests that mutate the body (delete a field,
 * swap an option) never corrupt the shared fixture for later tests.
 */
export function submissionBody(g: Golden, session_id: string) {
	return {
		session_id,
		answers: { ...g.answers },
		contact: {
			first_name: g.contact.first_name,
			whatsapp: g.contact.whatsapp,
			...(g.contact.school ? { school: g.contact.school } : {}),
			respondent_type: g.contact.respondent_type,
			consent: true,
		},
	};
}
