import { describe, expect, it } from 'vitest';
import { leadStatus } from '../src/lib/leadScore';
import { leadingLetter, score } from '../src/lib/scoring';
import type { Answers, Computed } from '../src/types';
import { GOLDENS } from './fixtures';

// ─── helpers (all using the exact locked option strings) ──────────────────────

/** Correct locked option for each scored question (mirror of answerKey.ts letters). */
const CORRECT = {
	q5: 'C) 300',
	q6: 'B) In addition',
	q7: 'B) 4',
	q8: 'B) self-reproach',
	q9: 'B) 96%',
	q10: 'B) library; only',
	q11: 'A) 12',
	q12: 'B) Food may have been prepared or eaten outside the walled area.',
} as const;

/** A valid, all-wrong (raw 0/0) answer set built from locked options; spread + override. */
function baseAnswers(overrides: Partial<Answers> = {}): Answers {
	return {
		target_score: '1100–1249',
		grade: 'Grade 11',
		test_date: '4–6 months',
		sat_history: 'Never taken one',
		q5: 'A) 15',
		q6: 'A) Nevertheless',
		q7: 'A) 3',
		q8: 'A) nostalgia',
		q9: 'A) 100%',
		q10: 'A) library, only',
		q11: 'B) 9',
		q12: 'A) The inhabitants did not eat the grain they grew.',
		hours_per_week: '2–4',
		timing: 'Finish with time to spare',
		review_mistakes: 'Sometimes',
		prep_status: 'With another tutor or course',
		worried_about: 'Running out of time',
		...overrides,
	};
}

// ─── golden cases (PRD §17) — locked strings, exact outputs ───────────────────

describe('golden cases (PRD §17)', () => {
	for (const [name, g] of Object.entries(GOLDENS)) {
		it(`${name} → matches the reference spreadsheet exactly`, () => {
			const result = score({ answers: g.answers, contact: { whatsapp: g.contact.whatsapp, school: g.contact.school ?? null } });
			expect(result).toEqual(g.expected);
		});
	}
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('prior-score band override (§7.3) + confidence (§7.4)', () => {
	// All answers wrong (raw 0/0 → estimate 800-1040), so any non-estimate band proves override.
	const cases: Array<[string, string, Computed['confidence']]> = [
		['Official SAT — 1300+', '1300-1500', 'Moderate'],
		['Official SAT — 1100–1299', '1150-1320', 'Moderate'],
		['Official SAT — under 1100', '980-1120', 'Moderate'],
		['Practice only — 1300+', '1250-1450', 'Low-Moderate'],
		['Practice only — 1100–1299', '1120-1300', 'Low-Moderate'],
		['Practice only — under 1100', '950-1120', 'Low-Moderate'],
	];

	for (const [sat_history, band, confidence] of cases) {
		it(`${sat_history} → ${band} (${confidence})`, () => {
			const result = score({ answers: baseAnswers({ sat_history }), contact: {} });
			expect(result.overall_band).toBe(band);
			expect(result.confidence).toBe(confidence);
		});
	}

	it('never taken → estimated band from raw (no override)', () => {
		expect(score({ answers: baseAnswers(), contact: {} }).overall_band).toBe('800-1040');
	});
});

describe('estimated band from raw sections (§7.2)', () => {
	it('all correct, never taken → 1240-1480', () => {
		const result = score({ answers: baseAnswers(CORRECT), contact: {} });
		expect(result.math_raw).toBe(8);
		expect(result.rw_raw).toBe(8);
		expect(result.overall_band).toBe('1240-1480'); // [620,740] + [620,740]
	});

	it('math_raw=3, rw_raw=5, never taken → 1030-1240', () => {
		// math: q5(1)+q7(2)=3 → [480,580]; rw: q10(2)+q12(3)=5 → [550,660]
		const result = score({ answers: baseAnswers({ q5: CORRECT.q5, q7: CORRECT.q7, q10: CORRECT.q10, q12: CORRECT.q12 }), contact: {} });
		expect(result.math_raw).toBe(3);
		expect(result.rw_raw).toBe(5);
		expect(result.overall_band).toBe('1030-1240');
	});
});

describe('archetype precedence (§7.5, first match wins)', () => {
	it('Time-Pressured beats Lopsided when the student runs out of time', () => {
		// math 8, rw 1 → |diff|=7 (would be Lopsided R&W-weak) but timing says "Run out"
		const answers = baseAnswers({
			timing: 'Run out of time and rush or guess the last questions',
			q5: CORRECT.q5,
			q7: CORRECT.q7,
			q9: CORRECT.q9,
			q11: CORRECT.q11,
			q6: CORRECT.q6,
		});
		expect(score({ answers, contact: {} }).archetype).toBe('Time-Pressured');
	});

	it('Lopsided (Math-weak) when math << rw', () => {
		const answers = baseAnswers({ q6: CORRECT.q6, q8: CORRECT.q8, q10: CORRECT.q10, q12: CORRECT.q12, q5: CORRECT.q5 }); // rw 8, math 1
		expect(score({ answers, contact: {} }).archetype).toBe('Lopsided (Math-weak)');
	});

	it('Lopsided (R&W-weak) when rw << math', () => {
		const answers = baseAnswers({ q5: CORRECT.q5, q7: CORRECT.q7, q9: CORRECT.q9, q11: CORRECT.q11, q6: CORRECT.q6 }); // math 8, rw 1
		expect(score({ answers, contact: {} }).archetype).toBe('Lopsided (R&W-weak)');
	});

	it('Shaky Grammarian (rule 3) beats Plateaued Retaker (rule 4)', () => {
		// Official history (would be Plateaued), balanced raw, Q12 right & Q10 wrong.
		const answers = baseAnswers({
			sat_history: 'Official SAT — 1100–1299',
			q7: CORRECT.q7,
			q9: CORRECT.q9, // math 4
			q6: CORRECT.q6,
			q12: CORRECT.q12, // rw 4 (q6=1, q12=3); q8, q10 wrong → Q10 wrong, Q12 right
		});
		expect(score({ answers, contact: {} }).archetype).toBe('Shaky Grammarian');
	});

	it('Plateaued Retaker when a prior test exists and no earlier rule fires', () => {
		const answers = baseAnswers({ sat_history: 'Official SAT — 1100–1299' }); // raw 0/0, balanced
		expect(score({ answers, contact: {} }).archetype).toBe('Plateaued Retaker');
	});
});

describe('target number, current_mid, and null gap (§7.6/§7.7)', () => {
	it('gap is null when target is "Not sure yet" (even with a computed band)', () => {
		const result = score({ answers: baseAnswers({ sat_history: 'Official SAT — 1100–1299', target_score: 'Not sure yet' }), contact: {} });
		expect(result.target_num).toBe(0);
		expect(result.current_mid).toBe(1235); // midpoint of 1150-1320
		expect(result.gap).toBeNull();
	});

	it('maps every locked target option to its number (§7.6)', () => {
		const map: Array<[string, number]> = [
			['Under 1100', 1050],
			['1100–1249', 1175],
			['1250–1349', 1300],
			['1350–1449', 1400],
			['1450+', 1500],
			['Not sure yet', 0],
		];
		for (const [target_score, target_num] of map) {
			expect(score({ answers: baseAnswers({ target_score }), contact: {} }).target_num).toBe(target_num);
		}
	});
});

describe('lead status thresholds (§7.9, ref AQ2: HOT ≥ 8 · WARM ≥ 5 · COLD < 5)', () => {
	it('classifies at the reference thresholds', () => {
		expect(leadStatus(11)).toBe('HOT');
		expect(leadStatus(8)).toBe('HOT');
		expect(leadStatus(7.5)).toBe('WARM');
		expect(leadStatus(6.5)).toBe('WARM');
		expect(leadStatus(5)).toBe('WARM');
		expect(leadStatus(4.5)).toBe('COLD'); // < 5 → COLD (matches the spreadsheet)
		expect(leadStatus(4)).toBe('COLD');
		expect(leadStatus(0)).toBe('COLD');
	});
});

describe('leadingLetter (§7.1 matching)', () => {
	it('takes the first letter, uppercased, ignoring surrounding whitespace', () => {
		expect(leadingLetter('C) 300')).toBe('C');
		expect(leadingLetter('  b) library; only')).toBe('B');
		expect(leadingLetter('A) 12')).toBe('A');
	});
});
