/**
 * ⚠️ SERVER-ONLY — the scoring answer key (PRD §7.1).
 *
 * This file MUST NEVER be imported by anything under `web/` (the future frontend)
 * or shipped to the browser. It is imported only by `src/lib/scoring.ts`, which
 * runs inside the Worker. Exposing it would let students see the correct answers.
 *
 * Points per question (max 8 per section):
 *   Math: Q5=1, Q7=2, Q9=2, Q11=3   (total 8)
 *   R&W:  Q6=1, Q8=2, Q10=2, Q12=3  (total 8)
 * Answers are matched on the leading letter of the option string ("C) 300" → "C").
 */

export type Section = 'Math' | 'RW';

export interface AnswerKeyEntry {
	/** Correct option letter (uppercase). */
	correct: string;
	/** Point value of this question. */
	points: number;
	/** Which section the points count toward. */
	section: Section;
}

/** The 8 scored questions (Q5–Q12). */
export type ScoredQuestion = 'q5' | 'q6' | 'q7' | 'q8' | 'q9' | 'q10' | 'q11' | 'q12';

export const ANSWER_KEY: Record<ScoredQuestion, AnswerKeyEntry> = {
	q5: { correct: 'C', points: 1, section: 'Math' },
	q6: { correct: 'B', points: 1, section: 'RW' },
	q7: { correct: 'B', points: 2, section: 'Math' },
	q8: { correct: 'B', points: 2, section: 'RW' },
	q9: { correct: 'B', points: 2, section: 'Math' },
	q10: { correct: 'B', points: 2, section: 'RW' },
	q11: { correct: 'A', points: 3, section: 'Math' },
	q12: { correct: 'B', points: 3, section: 'RW' },
};

/** Maximum raw score for a single section. */
export const MAX_SECTION_RAW = 8;
