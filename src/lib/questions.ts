/**
 * The 22 diagnostic questions and their EXACT locked option strings, transcribed
 * verbatim from the reference spreadsheet (Forge_SAT_Diagnostic_Engine.xlsx, Tab ③
 * "Google Form + paste block"). This is the single source of truth for question
 * text; the frontend will import it for display in a later phase.
 *
 * ⚠️ The correct answers are NOT stored here — they live only in answerKey.ts
 * (server bundle). This file is safe for the browser: it reveals no answer key.
 *
 * Ranges use en-dashes (–) and Q4 uses an em-dash (—) separator, exactly as locked;
 * the scoring engine folds those to hyphens when matching (see normalize.ts), so the
 * wording here and the scoring stay in lock-step. Verified against Tab ③ by
 * test/questions.fidelity.test-support and the extraction check in the build notes.
 */

// ─── Section 1 — About You & Your Goal ────────────────────────────────────────
export const TARGET_SCORE_OPTIONS = ['Under 1100', '1100–1249', '1250–1349', '1350–1449', '1450+', 'Not sure yet'] as const;
export const GRADE_OPTIONS = ['Grade 10', 'Grade 11', 'Grade 12', 'Gap year', 'Other'] as const;
export const TEST_DATE_OPTIONS = ['Within 8 weeks', '2–4 months', '4–6 months', 'More than 6 months', 'No date set'] as const;
export const SAT_HISTORY_OPTIONS = [
	'Never taken one',
	'Practice only — under 1100',
	'Practice only — 1100–1299',
	'Practice only — 1300+',
	'Official SAT — under 1100',
	'Official SAT — 1100–1299',
	'Official SAT — 1300+',
] as const;

// ─── Section 2 — Quick Skills Check (scored; correct answers in answerKey.ts) ──
export const Q5_OPTIONS = ['A) 15', 'B) 240', 'C) 300', 'D) 540'] as const;
export const Q6_OPTIONS = ['A) Nevertheless', 'B) In addition', 'C) For example', 'D) By contrast'] as const;
export const Q7_OPTIONS = ['A) 3', 'B) 4', 'C) 6', 'D) 8'] as const;
export const Q8_OPTIONS = ['A) nostalgia', 'B) self-reproach', 'C) diplomacy', 'D) indifference'] as const;
export const Q9_OPTIONS = ['A) 100%', 'B) 96%', 'C) 104%', 'D) 98%'] as const;
// Q10 tests the punctuation BETWEEN "library" and "only": the options show ONLY the mark
// under test (F-M-Timer), not the surrounding words. The leading letter still drives scoring
// (answerKey q10 = "B" = the semicolon), so the correct answer is unchanged — only the visible
// text is shorter. C is the "no mark at all" choice ("…library only…").
export const Q10_OPTIONS = ['A) ,', 'B) ;', 'C) no punctuation', 'D) :'] as const;
export const Q11_OPTIONS = ['A) 12', 'B) 9', 'C) 15', 'D) 16'] as const;
export const Q12_OPTIONS = [
	'A) The inhabitants did not eat the grain they grew.',
	'B) Food may have been prepared or eaten outside the walled area.',
	'C) The settlement was abandoned before cooking could occur.',
	'D) Storage mattered more to them than farming.',
] as const;

/**
 * Per-question countdown limits for the 8 scored skills questions (F-M-Timer, Section 2 only).
 * The SAT is timed, so each skills question shows a calm on-brand countdown; when it runs out
 * we auto-advance and the client records that the student HIT the limit. Limits are owner-tuned
 * per question (roughly by difficulty and reading length) — generous enough to feel fair, tight
 * enough that genuinely running out of time is real signal, not noise. Sections 1, 3 and 4
 * (context + contact) are NOT timed. Safe for the browser — no answers here.
 */
export const SKILLS_TIME_LIMIT_SEC = {
	q5: 45, // Math, 1pt — short arithmetic word problem
	q6: 45, // R&W, 1pt — single transition word
	q7: 60, // Math, 2pt — quadratic (sum of roots)
	q8: 50, // R&W, 2pt — vocabulary in context
	q9: 60, // Math, 2pt — successive-percent reasoning
	q10: 60, // R&W, 2pt — one punctuation choice
	q11: 50, // Math, 3pt — right-triangle trig
	q12: 70, // R&W, 3pt — reading inference (most to read)
} as const;

/** The 8 scored skills questions, in order (Section 2). */
export const SKILLS_QUESTIONS = ['q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'q12'] as const;
export type SkillsQuestionKey = (typeof SKILLS_QUESTIONS)[number];

// ─── Section 3 — How You Study ────────────────────────────────────────────────
export const HOURS_OPTIONS = ['Less than 2', '2–4', '5–8', 'More than 8'] as const;
export const TIMING_OPTIONS = [
	'Finish with time to spare',
	'Finish right on time',
	'Run out of time and rush or guess the last questions',
	"I've never done a timed section",
] as const;
export const REVIEW_OPTIONS = ['Almost always', 'Sometimes', 'Rarely', "I don't do practice questions"] as const;
export const PREP_OPTIONS = ['On my own', 'Through my school', 'With another tutor or course', 'Not really preparing yet'] as const;
export const WORRIED_OPTIONS = ['Reading', 'Writing & grammar', 'Math', 'Running out of time', 'Honestly, all of it'] as const;

// ─── Section 4 — Contact ──────────────────────────────────────────────────────
export const RESPONDENT_OPTIONS = ['Student', 'Parent'] as const;
export const CONSENT_TEXT =
	'I agree to receive my results and info about Forge on WhatsApp. (If you’re under 18, please make sure a parent knows.)';

/**
 * Allowed option strings for every choice-type ANSWER field. The validation schema
 * (validation.ts) builds a zod enum from each, so any answer not in this set is a 400.
 */
export const ANSWER_OPTIONS = {
	target_score: TARGET_SCORE_OPTIONS,
	grade: GRADE_OPTIONS,
	test_date: TEST_DATE_OPTIONS,
	sat_history: SAT_HISTORY_OPTIONS,
	q5: Q5_OPTIONS,
	q6: Q6_OPTIONS,
	q7: Q7_OPTIONS,
	q8: Q8_OPTIONS,
	q9: Q9_OPTIONS,
	q10: Q10_OPTIONS,
	q11: Q11_OPTIONS,
	q12: Q12_OPTIONS,
	hours_per_week: HOURS_OPTIONS,
	timing: TIMING_OPTIONS,
	review_mistakes: REVIEW_OPTIONS,
	prep_status: PREP_OPTIONS,
	worried_about: WORRIED_OPTIONS,
} as const;

export type QuestionKind = 'choice' | 'short_text' | 'consent';

export interface Question {
	/** Question number 1–22. */
	n: number;
	/** The field this maps to (answer field key, or a contact field). */
	field: string;
	/** Which of the 4 sections it belongs to. */
	section: 1 | 2 | 3 | 4;
	prompt: string;
	kind: QuestionKind;
	/** Present for choice questions. */
	options?: readonly string[];
	/** All required except Q20 (school) per PRD F2. */
	required: boolean;
	/** Countdown limit in seconds — set ONLY on the 8 scored skills questions (Section 2). */
	time_limit_sec?: number;
}

/** Full display metadata for the 22 questions (for the frontend, later phase). */
export const QUESTIONS: readonly Question[] = [
	{ n: 1, field: 'target_score', section: 1, kind: 'choice', required: true, prompt: 'What SAT score are you aiming for?', options: TARGET_SCORE_OPTIONS },
	{ n: 2, field: 'grade', section: 1, kind: 'choice', required: true, prompt: 'What grade are you in?', options: GRADE_OPTIONS },
	{ n: 3, field: 'test_date', section: 1, kind: 'choice', required: true, prompt: 'When is your SAT test date?', options: TEST_DATE_OPTIONS },
	{ n: 4, field: 'sat_history', section: 1, kind: 'choice', required: true, prompt: 'Have you taken a real or full practice SAT? Most recent total?', options: SAT_HISTORY_OPTIONS },
	{ n: 5, field: 'q5', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q5, prompt: "A phone plan charges a flat $12/month plus $0.05 per text. One month's bill was $27. How many texts were sent?", options: Q5_OPTIONS },
	{ n: 6, field: 'q6', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q6, prompt: 'Solar panel efficiency has improved steadily over the past decade. ____, the cost per watt has fallen by more than 80%, making home installation affordable for many families.', options: Q6_OPTIONS },
	{ n: 7, field: 'q7', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q7, prompt: 'The function f(x) = 2x² − 8x + 6 crosses the x-axis at two points. What is the sum of those x-coordinates?', options: Q7_OPTIONS },
	{ n: 8, field: 'q8', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q8, prompt: '…she is unsparing about her own early missteps, recounting them with a candor that borders on ____; she seems almost eager to expose the naïveté of her younger self.', options: Q8_OPTIONS },
	{ n: 9, field: 'q9', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q9, prompt: "A jacket's price is raised 20%, then later marked 20% off the increased price. The final price is what percent of the original?", options: Q9_OPTIONS },
	{ n: 10, field: 'q10', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q10, prompt: 'The committee reviewed three proposals for the new library ____ only one, however, met the budget requirements.', options: Q10_OPTIONS },
	{ n: 11, field: 'q11', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q11, prompt: 'In right triangle ABC (right angle at C), sin(A) = 3/5 and hypotenuse AB = 20. Length of the side opposite angle A?', options: Q11_OPTIONS },
	{ n: 12, field: 'q12', section: 2, kind: 'choice', required: true, time_limit_sec: SKILLS_TIME_LIMIT_SEC.q12, prompt: 'No cooking hearths were found inside the walls, though surrounding fields showed abundant grain farming, and storage pits were unusually large. Best-supported conclusion?', options: Q12_OPTIONS },
	{ n: 13, field: 'hours_per_week', section: 3, kind: 'choice', required: true, prompt: 'Hours/week studying for the SAT right now?', options: HOURS_OPTIONS },
	{ n: 14, field: 'timing', section: 3, kind: 'choice', required: true, prompt: 'Under timed conditions, you usually…', options: TIMING_OPTIONS },
	{ n: 15, field: 'review_mistakes', section: 3, kind: 'choice', required: true, prompt: 'When you get a question wrong, do you figure out why?', options: REVIEW_OPTIONS },
	{ n: 16, field: 'prep_status', section: 3, kind: 'choice', required: true, prompt: 'How are you preparing right now?', options: PREP_OPTIONS },
	{ n: 17, field: 'worried_about', section: 3, kind: 'choice', required: true, prompt: 'Which part of the SAT worries you most?', options: WORRIED_OPTIONS },
	{ n: 18, field: 'first_name', section: 4, kind: 'short_text', required: true, prompt: 'First name' },
	{ n: 19, field: 'whatsapp', section: 4, kind: 'short_text', required: true, prompt: 'WhatsApp number' },
	{ n: 20, field: 'school', section: 4, kind: 'short_text', required: false, prompt: 'Which school do you attend?' },
	{ n: 21, field: 'respondent_type', section: 4, kind: 'choice', required: true, prompt: 'Completing this as the…', options: RESPONDENT_OPTIONS },
	{ n: 22, field: 'consent', section: 4, kind: 'consent', required: true, prompt: CONSENT_TEXT },
];
