/**
 * Pure scoring engine (PRD §7). No I/O, no database, no network — just arithmetic,
 * so it is trivial to unit-test and stays far under the 10ms CPU limit.
 *
 * `score(input)` reproduces the reference spreadsheet exactly; the golden cases in
 * test/scoring.test.ts (Rami/Lina/Karim, PRD §17) are the proof of correctness.
 *
 * Answer OPTION strings are not enumerated verbatim in the PRD, so matching is by
 * the stable keywords §7 itself uses ("Run out", "Within 8 weeks", "Not sure",
 * "Official", "Practice", "Never", "1300", "1100-1299", "below 1100", …). The
 * eventual questions config (src/lib/questions.ts, frontend phase) must use phrasing
 * compatible with these keywords.
 */
import { ANSWER_KEY, type ScoredQuestion } from './answerKey';
import { computeLeadScore, leadStatus, recommendProgram } from './leadScore';
import type { Answers, Computed, ScoreInput } from '../types';

type Archetype = Computed['archetype'];
type Confidence = Computed['confidence'];
type Timeline = Computed['timeline_verdict'];

const SCORED_QUESTIONS: ScoredQuestion[] = ['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'];

/** Leading letter of an option string, uppercased ("C) 300" → "C"). PRD §7.1. */
export function leadingLetter(option: string): string {
	return option.trim().charAt(0).toUpperCase();
}

interface RawResult {
	math_raw: number;
	rw_raw: number;
	/** Per-question correctness (needed for the archetype rules). */
	correct: Record<ScoredQuestion, boolean>;
}

/** §7.1 raw Math/R&W scores by matching the leading letter against the answer key. */
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

/** §7.2 section band [low, high] from a raw score (of 8). */
function sectionBand(raw: number): [number, number] {
	if (raw <= 2) return [400, 520];
	if (raw <= 4) return [480, 580];
	if (raw <= 6) return [550, 660];
	return [620, 740]; // 7–8
}

type HistoryType = 'official' | 'practice' | 'never' | 'unknown';
type ScoreBucket = 'high' | 'mid' | 'low' | null;

interface History {
	type: HistoryType;
	bucket: ScoreBucket; // prior-score band: 1300+ / 1100-1299 / below 1100
}

/** Classify sat_history (Q4) into test type + prior-score bucket (PRD §7.3/§7.4). */
function classifyHistory(satHistory: string): History {
	const s = satHistory.toLowerCase();

	let type: HistoryType;
	if (s.includes('never')) type = 'never';
	else if (s.includes('official')) type = 'official';
	else if (s.includes('practice')) type = 'practice';
	else type = 'unknown';

	let bucket: ScoreBucket = null;
	if (s.includes('1300')) bucket = 'high';
	else if (s.includes('1100-1299') || (s.includes('1100') && s.includes('1299'))) bucket = 'mid';
	else if (s.includes('below 1100') || s.includes('under 1100')) bucket = 'low';

	return { type, bucket };
}

/** §7.3 overall band — a prior official/practice score OVERRIDES our estimate. */
function overallBand(history: History, estLow: number, estHigh: number): string {
	const estimate = `${estLow}-${estHigh}`;
	if (history.type === 'official') {
		if (history.bucket === 'high') return '1300-1500';
		if (history.bucket === 'mid') return '1150-1320';
		if (history.bucket === 'low') return '980-1120';
		return estimate; // official but no readable bucket → fall back to estimate
	}
	if (history.type === 'practice') {
		if (history.bucket === 'high') return '1250-1450';
		if (history.bucket === 'mid') return '1120-1300';
		if (history.bucket === 'low') return '950-1120';
		return estimate;
	}
	return estimate; // never taken / unknown → estimated band
}

/** §7.4 confidence from test type. */
function confidenceOf(history: History): Confidence {
	if (history.type === 'official') return 'Moderate';
	if (history.type === 'practice') return 'Low-Moderate';
	return 'Low'; // never / unknown
}

/** §7.5 archetype — top-down, FIRST match wins. */
function archetypeOf(a: Answers, raw: RawResult, history: History): Archetype {
	// 1. Time pressure beats everything.
	if (/run out/i.test(a.timing)) return 'Time-Pressured';
	// 2. A ≥3-point section imbalance.
	if (Math.abs(raw.math_raw - raw.rw_raw) >= 3) {
		return raw.math_raw < raw.rw_raw ? 'Lopsided (Math-weak)' : 'Lopsided (R&W-weak)';
	}
	// 3. Reading fine but grammar leaks: Q12 right, Q10 wrong.
	if (raw.correct.q12 && !raw.correct.q10) return 'Shaky Grammarian';
	// 4. Has taken a real/practice test before → plateaued.
	if (history.type === 'official' || history.type === 'practice') return 'Plateaued Retaker';
	// 5. Not enough data yet.
	return 'Untested Unknown';
}

/** §7.6 target number from the target_score option. */
function targetNumberOf(targetScore: string): number {
	const t = targetScore.toLowerCase();
	if (t.includes('not sure')) return 0;
	if (t.includes('1450')) return 1500;
	if (t.includes('1350-1449')) return 1400;
	if (t.includes('1250-1349')) return 1300;
	if (t.includes('1100-1249')) return 1175;
	if (t.includes('under 1100') || t.includes('below 1100')) return 1050;
	return 0; // unrecognized → treat as "not sure"
}

/** Midpoint of an "low-high" band string (PRD §7.7). Always an integer for our bands. */
function bandMidpoint(band: string): number {
	const [low, high] = band.split('-').map((n) => Number(n));
	return Math.round((low + high) / 2);
}

/** §7.8 timeline verdict from test_date + gap. */
function timelineVerdict(testDate: string, gap: number | null): Timeline {
	const t = testDate.toLowerCase();
	if (t.includes('8 week')) return gap !== null && gap >= 100 ? 'Aggressive' : 'Tight but doable';
	if (t.includes('2-4 month')) return 'Reasonable';
	if (t.includes('4-6 month')) return 'Comfortable';
	return 'Early / lots of runway'; // more than 6 months / no date set
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
	const overall_band = overallBand(history, estLow, estHigh);
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
