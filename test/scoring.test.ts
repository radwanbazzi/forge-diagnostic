import { describe, expect, it } from 'vitest';
import { leadStatus } from '../src/lib/leadScore';
import { leadingLetter, score } from '../src/lib/scoring';
import type { Answers, Computed, ScoringContact } from '../src/types';

// ─── helpers ────────────────────────────────────────────────────────────────

/** A fully-valid, all-wrong (raw 0/0) answer set to spread + override in edge tests. */
function baseAnswers(overrides: Partial<Answers> = {}): Answers {
	return {
		target_score: '1100-1249',
		grade: 'Grade 11',
		test_date: '4-6 months',
		sat_history: "I've never taken a full SAT",
		q5: 'X) wrong',
		q6: 'X) wrong',
		q7: 'X) wrong',
		q8: 'X) wrong',
		q9: 'X) wrong',
		q10: 'X) wrong',
		q11: 'X) wrong',
		q12: 'X) wrong',
		hours_per_week: '2-4 hours',
		timing: 'I finish with time to spare',
		review_mistakes: 'Sometimes',
		prep_status: 'With another tutor / center',
		worried_about: 'Timing',
		...overrides,
	};
}

// ─── golden cases (PRD §17) — must match the reference spreadsheet exactly ─────

describe('golden cases (PRD §17)', () => {
	it('Rami → HOT Plateaued Retaker, band 1150-1320, gap 165, lead 11', () => {
		const answers: Answers = {
			target_score: '1350-1449',
			grade: 'Grade 12',
			test_date: 'Within 8 weeks',
			sat_history: 'Official SAT: 1100-1299',
			// math_raw=5 (q5,q7,q9 right; q11 wrong), rw_raw=6 (q6,q10,q12 right; q8 wrong), Q10 correct
			q5: 'C) 300',
			q6: 'B) because',
			q7: 'B) 12',
			q8: 'A) whom',
			q9: 'B) 45',
			q10: 'B) however',
			q11: 'C) 7',
			q12: 'B) had gone',
			hours_per_week: '5-8 hours',
			timing: 'I finish right on time',
			review_mistakes: 'Sometimes',
			prep_status: 'On my own',
			worried_about: 'Math',
		};
		const contact: ScoringContact = { whatsapp: '+961 3 111111', school: 'International College' };

		const expected: Computed = {
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
		};

		expect(score({ answers, contact })).toEqual(expected);
	});

	it('Lina → WARM Time-Pressured, band 1120-1300, gap 90, lead 6.5', () => {
		const answers: Answers = {
			target_score: '1250-1349',
			grade: 'Grade 11',
			test_date: '4-6 months',
			sat_history: 'Practice test: 1100-1299',
			// math_raw=6 (q5,q7,q11 right; q9 wrong), rw_raw=6 (q6,q10,q12 right; q8 wrong)
			q5: 'C) 300',
			q6: 'B) because',
			q7: 'B) 12',
			q8: 'A) whom',
			q9: 'A) 44',
			q10: 'B) however',
			q11: 'A) 6',
			q12: 'B) had gone',
			hours_per_week: '2-4 hours',
			timing: 'I run out of time on some sections',
			review_mistakes: 'Rarely',
			prep_status: 'With my school',
			worried_about: 'Reading',
		};
		const contact: ScoringContact = { whatsapp: '+961 3 222222', school: null };

		const expected: Computed = {
			math_raw: 6,
			rw_raw: 6,
			overall_band: '1120-1300',
			confidence: 'Low-Moderate',
			archetype: 'Time-Pressured',
			target_num: 1300,
			current_mid: 1210,
			gap: 90,
			timeline_verdict: 'Comfortable',
			recommended_program: '$130 SAT Accelerator',
			lead_score: 6.5,
			lead_status: 'WARM',
		};

		expect(score({ answers, contact })).toEqual(expected);
	});

	it('Karim → COLD Untested Unknown, band 880-1100, gap null, lead 4', () => {
		const answers: Answers = {
			target_score: 'Not sure',
			grade: 'Grade 10',
			test_date: 'No date set',
			sat_history: "I've never taken a full SAT",
			// math_raw=2 (q9 right), rw_raw=4 (q8,q10 right; Q12 wrong so NOT Shaky Grammarian)
			q5: 'A) 200',
			q6: 'A) and',
			q7: 'A) 10',
			q8: 'B) whom',
			q9: 'B) 45',
			q10: 'B) however',
			q11: 'B) 6',
			q12: 'A) has went',
			hours_per_week: 'Less than 2 hours',
			timing: "I've never done a timed section",
			review_mistakes: 'Never',
			prep_status: 'Not really / not yet',
			worried_about: 'Everything',
		};
		const contact: ScoringContact = { whatsapp: '+961 3 333333', school: null };

		const expected: Computed = {
			math_raw: 2,
			rw_raw: 4,
			overall_band: '880-1100',
			confidence: 'Low',
			archetype: 'Untested Unknown',
			target_num: 0,
			current_mid: 990,
			gap: null,
			timeline_verdict: 'Early / lots of runway',
			recommended_program: '$80 SAT Essentials',
			lead_score: 4,
			lead_status: 'COLD',
		};

		expect(score({ answers, contact })).toEqual(expected);
	});
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('prior-score band override (§7.3) + confidence (§7.4)', () => {
	// All answers wrong (raw 0/0 → estimate 800-1040), so any non-estimate band proves the override.
	const cases: Array<[string, string, Computed['confidence']]> = [
		['Official SAT: 1300+', '1300-1500', 'Moderate'],
		['Official SAT: 1100-1299', '1150-1320', 'Moderate'],
		['Official SAT: below 1100', '980-1120', 'Moderate'],
		['Practice test: 1300+', '1250-1450', 'Low-Moderate'],
		['Practice test: 1100-1299', '1120-1300', 'Low-Moderate'],
		['Practice test: below 1100', '950-1120', 'Low-Moderate'],
	];

	for (const [sat_history, band, confidence] of cases) {
		it(`${sat_history} → ${band} (${confidence})`, () => {
			const result = score({ answers: baseAnswers({ sat_history }), contact: {} });
			expect(result.overall_band).toBe(band);
			expect(result.confidence).toBe(confidence);
		});
	}

	it('never taken → estimated band from raw (no override)', () => {
		// all wrong → math 0 [400,520], rw 0 [400,520] → 800-1040
		expect(score({ answers: baseAnswers(), contact: {} }).overall_band).toBe('800-1040');
	});
});

describe('estimated band from raw sections (§7.2)', () => {
	it('all correct, never taken → 1240-1480', () => {
		const answers = baseAnswers({
			q5: 'C)',
			q6: 'B)',
			q7: 'B)',
			q8: 'B)',
			q9: 'B)',
			q10: 'B)',
			q11: 'A)',
			q12: 'B)',
		});
		const result = score({ answers, contact: {} });
		expect(result.math_raw).toBe(8);
		expect(result.rw_raw).toBe(8);
		expect(result.overall_band).toBe('1240-1480'); // [620,740] + [620,740]
	});

	it('math_raw=3, rw_raw=5, never taken → 1030-1240', () => {
		// math: q5(1)+q7(2)=3 → [480,580]; rw: q10(2)+q12(3)=5 → [550,660]
		const answers = baseAnswers({ q5: 'C)', q7: 'B)', q10: 'B)', q12: 'B)' });
		const result = score({ answers, contact: {} });
		expect(result.math_raw).toBe(3);
		expect(result.rw_raw).toBe(5);
		expect(result.overall_band).toBe('1030-1240');
	});
});

describe('archetype precedence (§7.5, first match wins)', () => {
	it('Time-Pressured beats Lopsided when the student runs out of time', () => {
		// math_raw=8, rw_raw=1 → |diff|=7 (would be Lopsided R&W-weak) but timing says "run out"
		const answers = baseAnswers({
			timing: 'I run out of time on some sections',
			q5: 'C)',
			q7: 'B)',
			q9: 'B)',
			q11: 'A)', // math 8
			q6: 'B)', // rw 1
		});
		expect(score({ answers, contact: {} }).archetype).toBe('Time-Pressured');
	});

	it('Lopsided (Math-weak) when math << rw', () => {
		const answers = baseAnswers({ q6: 'B)', q8: 'B)', q10: 'B)', q12: 'B)', q5: 'C)' }); // rw 8, math 1
		expect(score({ answers, contact: {} }).archetype).toBe('Lopsided (Math-weak)');
	});

	it('Lopsided (R&W-weak) when rw << math', () => {
		const answers = baseAnswers({ q5: 'C)', q7: 'B)', q9: 'B)', q11: 'A)', q6: 'B)' }); // math 8, rw 1
		expect(score({ answers, contact: {} }).archetype).toBe('Lopsided (R&W-weak)');
	});

	it('Shaky Grammarian (rule 3) beats Plateaued Retaker (rule 4)', () => {
		// Official history (would be Plateaued), balanced raw, but Q12 right & Q10 wrong.
		const answers = baseAnswers({
			sat_history: 'Official SAT: 1100-1299',
			q7: 'B)',
			q9: 'B)', // math 4
			q6: 'B)',
			q12: 'B)', // rw 4 (q6=1, q12=3); q8, q10 wrong → Q10 wrong, Q12 right
		});
		expect(score({ answers, contact: {} }).archetype).toBe('Shaky Grammarian');
	});

	it('Plateaued Retaker when a prior test exists and no earlier rule fires', () => {
		const answers = baseAnswers({ sat_history: 'Official SAT: 1100-1299' }); // raw 0/0, balanced
		expect(score({ answers, contact: {} }).archetype).toBe('Plateaued Retaker');
	});
});

describe('target number, current_mid, and null gap (§7.6/§7.7)', () => {
	it('gap is null when target is "Not sure" (even with a computed band)', () => {
		const result = score({ answers: baseAnswers({ sat_history: 'Official SAT: 1100-1299', target_score: 'Not sure' }), contact: {} });
		expect(result.target_num).toBe(0);
		expect(result.current_mid).toBe(1235); // midpoint of 1150-1320
		expect(result.gap).toBeNull();
	});

	it('maps every target band to its number (§7.6)', () => {
		const map: Array<[string, number]> = [
			['Under 1100', 1050],
			['1100-1249', 1175],
			['1250-1349', 1300],
			['1350-1449', 1400],
			['1450+', 1500],
			['Not sure', 0],
		];
		for (const [target_score, target_num] of map) {
			expect(score({ answers: baseAnswers({ target_score }), contact: {} }).target_num).toBe(target_num);
		}
	});
});

describe('lead status thresholds (§7.9)', () => {
	it('HOT ≥ 8, COLD ≤ 4, WARM in between (incl. the 7.x gap)', () => {
		expect(leadStatus(11)).toBe('HOT');
		expect(leadStatus(8)).toBe('HOT');
		expect(leadStatus(7.5)).toBe('WARM');
		expect(leadStatus(7)).toBe('WARM');
		expect(leadStatus(6.5)).toBe('WARM');
		expect(leadStatus(5)).toBe('WARM');
		expect(leadStatus(4.5)).toBe('WARM');
		expect(leadStatus(4)).toBe('COLD');
		expect(leadStatus(0)).toBe('COLD');
	});
});

describe('leadingLetter (§7.1 matching)', () => {
	it('takes the first letter, uppercased, ignoring surrounding whitespace', () => {
		expect(leadingLetter('C) 300')).toBe('C');
		expect(leadingLetter('  b) however')).toBe('B');
		expect(leadingLetter('A) 6')).toBe('A');
	});
});
