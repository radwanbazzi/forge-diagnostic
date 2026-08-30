/**
 * Pure scoring engine (PRD §7), reproducing the reference spreadsheet's row-2
 * formulas exactly (Tab ③, columns X–AQ). No I/O, no database, no network — just
 * arithmetic, so it is trivial to unit-test and stays far under the 10ms CPU limit.
 *
 * `score(input)` matches the locked questionnaire wording: string matching folds
 * en/em dashes to hyphens (normalizeOption) and keys on the same tokens the
 * reference formulas use ("Run out", "8 week", "Official"/"Practice"/"Never",
 * "1300"/"under"/"1100-1299", the target numbers, "5-8"/"2-4", "school", …).
 * The golden cases in test/scoring.test.ts (PRD §17) are the proof of correctness.
 */
import { ANSWER_KEY, MAX_SECTION_RAW, type ScoredQuestion } from './answerKey';
import { computeLeadScore, leadStatus, recommendProgram } from './leadScore';
import { normalizeOption } from './normalize';
import type { Answers, Computed, ScoreInput } from '../types';

type Archetype = Computed['archetype'];
type Confidence = Computed['confidence'];
type Timeline = Computed['timeline_verdict'];

const SCORED_QUESTIONS: ScoredQuestion[] = ['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'];

/** Leading letter of an option string, uppercased ("C) 300" → "C"). PRD §7.1 (ref LEFT(_,2)). */
export function leadingLetter(option: string): string {
	return option.trim().charAt(0).toUpperCase();
}

interface RawResult {
	math_raw: number;
	rw_raw: number;
	/** Per-question correctness (needed for the archetype rules). */
	correct: Record<ScoredQuestion, boolean>;
}

/** §7.1 raw Math/R&W scores by matching the leading letter against the answer key (ref X2/Y2). */
function scoreRaw(a: Answers): RawResult {
	let math_raw = 0;
	let rw_raw = 0;
	const correct = {} as Record<ScoredQuestion, boolean>;

	for (const q of SCORED_QUESTIONS) {
		const key = ANSWER_KEY[q];
		const isCorrect = leadingLetter(a[q]) === key.correct;
		correct[q] = isCorrect;
		if (isCorrect) {
			if (key.section === 'Math') math_raw += key.points;
			else rw_raw += key.points;
		}
	}

	return { math_raw, rw_raw, correct };
}

/**
 * §7.2 section band [low, high] from a raw section score of 0–8 (each section of 8).
 * Per-point curve (lowered from v1). A raw 8 in a single section can still occur in a
 * non-perfect total (15/16 = 8 + 7); the 16/16 "perfect run" is handled separately in
 * score() (top band 1400-1500), so it is NOT baked into this table.
 */
function sectionBand(raw: number): [number, number] {
	switch (raw) {
		case 8:
			return [680, 720];
		case 7:
			return [560, 610];
		case 6:
			return [500, 560];
		case 5:
			return [440, 500];
		case 4:
			return [380, 450];
		case 3:
			return [320, 390];
		case 2:
			return [270, 340];
		case 1:
			return [230, 300];
		default:
			return [200, 260]; // 0
	}
}

type HistoryType = 'official' | 'practice' | 'never' | 'unknown';
type ScoreBucket = 'high' | 'mid' | 'low' | null;

interface History {
	type: HistoryType;
	bucket: ScoreBucket; // prior-score band: 1300+ / 1100-1299 / under 1100
}

/** Classify sat_history (Q4) into test type + prior-score bucket (PRD §7.3/§7.4, ref AD2/AE2). */
function classifyHistory(satHistory: string): History {
	const s = normalizeOption(satHistory);

	let type: HistoryType;
	if (s.includes('never')) type = 'never';
	else if (s.includes('official')) type = 'official';
	else if (s.includes('practice')) type = 'practice';
	else type = 'unknown';

	let bucket: ScoreBucket = null;
	if (s.includes('1300')) bucket = 'high';
	else if (s.includes('1100-1299')) bucket = 'mid';
	else if (s.includes('under 1100') || s.includes('below 1100')) bucket = 'low';

	return { type, bucket };
}

/** §7.3 overall band — a prior official/practice score OVERRIDES our estimate (ref AD2). */
function overallBand(history: History, estLow: number, estHigh: number): string {
	const estimate = `${estLow}-${estHigh}`;
	if (history.type === 'official') {
		if (history.bucket === 'high') return '1250-1400';
		if (history.bucket === 'low') return '900-1040';
		if (history.bucket === 'mid') return '1040-1200';
		return estimate; // official but no readable bucket → fall back to estimate
	}
	if (history.type === 'practice') {
		if (history.bucket === 'high') return '1080-1240';
		if (history.bucket === 'low') return '840-1000';
		if (history.bucket === 'mid') return '960-1120';
		return estimate;
	}
	return estimate; // never taken / unknown → estimated band
}

/** §7.4 confidence from test type (ref AE2). */
function confidenceOf(history: History): Confidence {
	if (history.type === 'official') return 'Moderate';
	if (history.type === 'practice') return 'Low-Moderate';
	return 'Low'; // never / unknown
}

/** §7.5 archetype — top-down, FIRST match wins (ref AF2). */
function archetypeOf(a: Answers, raw: RawResult, history: History): Archetype {
	// 1. Time pressure beats everything.
	if (normalizeOption(a.timing).includes('run out')) return 'Time-Pressured';
	// 2. A ≥3-point section imbalance.
	if (Math.abs(raw.math_raw - raw.rw_raw) >= 3) {
		return raw.math_raw < raw.rw_raw ? 'Lopsided (Math-weak)' : 'Lopsided (R&W-weak)';
	}
	// 3. Reading fine but grammar leaks: Q12 right (B), Q10 wrong (≠B).
	if (raw.correct.q12 && !raw.correct.q10) return 'Shaky Grammarian';
	// 4. Has taken a real/practice test before → plateaued (ref: sat_history ≠ "Never taken one").
	if (history.type === 'official' || history.type === 'practice') return 'Plateaued Retaker';
	// 5. Not enough data yet.
	return 'Untested Unknown';
}

/** §7.6 target number from the target_score option (ref AG2). */
function targetNumberOf(targetScore: string): number {
	const t = normalizeOption(targetScore);
	if (t.includes('under 1100')) return 1050;
	if (t.includes('1450')) return 1500;
	if (t.includes('1350')) return 1400;
	if (t.includes('1250')) return 1300;
	if (t.includes('1100')) return 1175;
	return 0; // "Not sure yet" (and anything unrecognized)
}

/** Midpoint of a "low-high" band string (PRD §7.7, ref AH2). Always integer for our bands. */
function bandMidpoint(band: string): number {
	const [low, high] = band.split('-').map((n) => Number(n));
	return Math.round((low + high) / 2);
}

/** §7.8 timeline verdict from test_date + gap (ref AJ2). */
function timelineVerdict(testDate: string, gap: number | null): Timeline {
	const t = normalizeOption(testDate);
	if (t.includes('8 week')) return gap !== null && gap >= 100 ? 'Aggressive' : 'Tight but doable';
	if (t.includes('2-4 month')) return 'Reasonable';
	if (t.includes('4-6 month')) return 'Comfortable';
	return 'Early / lots of runway'; // more than 6 months / no date set
}

/**
 * Guard against an impossible computed state (US-1.8): if this ever throws/returns
 * false the caller must fail closed (500, no partial row) rather than persist garbage.
 */
export function isValidComputed(c: Computed): boolean {
	return (
		Number.isInteger(c.math_raw) &&
		Number.isInteger(c.rw_raw) &&
		/^\d+-\d+$/.test(c.overall_band) &&
		Number.isFinite(c.current_mid) &&
		Number.isFinite(c.lead_score)
	);
}

/** The one public entry point: answers → all computed fields (PRD §7). Pure. */
export function score(input: ScoreInput): Computed {
	const { answers, contact } = input;

	const raw = scoreRaw(answers);
	const [mathLow, mathHigh] = sectionBand(raw.math_raw);
	const [rwLow, rwHigh] = sectionBand(raw.rw_raw);
	const estLow = mathLow + rwLow;
	const estHigh = mathHigh + rwHigh;

	const history = classifyHistory(answers.sat_history);

	// §7.2 special rule: a PERFECT run — full marks in BOTH sections (16/16) AND no prior
	// score reported (never tested) — is the ONLY way to reach the top band via the estimate.
	// Any single wrong answer drops to the per-point curve above. A reported prior score
	// always defers to the §7.3 override instead (so this cannot fire for official/practice).
	const perfectRun =
		raw.math_raw === MAX_SECTION_RAW && raw.rw_raw === MAX_SECTION_RAW && history.type === 'never';
	const overall_band = perfectRun ? '1400-1500' : overallBand(history, estLow, estHigh);
	const confidence = confidenceOf(history);
	const archetype = archetypeOf(answers, raw, history);

	const target_num = targetNumberOf(answers.target_score);
	const current_mid = bandMidpoint(overall_band);
	const gap = target_num === 0 ? null : target_num - current_mid;

	const timeline_verdict = timelineVerdict(answers.test_date, gap);

	const lead_score = computeLeadScore(answers, contact, gap);
	const lead_status = leadStatus(lead_score);
	const recommended_program = recommendProgram(lead_status, archetype);

	return {
		math_raw: raw.math_raw,
		rw_raw: raw.rw_raw,
		overall_band,
		confidence,
		archetype,
		target_num,
		current_mid,
		gap,
		timeline_verdict,
		recommended_program,
		lead_score,
		lead_status,
	};
}
