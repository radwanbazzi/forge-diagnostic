/**
 * Request validation for POST /api/diagnostic/submit (BACKEND_SPEC §1 US-1, §4).
 *
 * Every answer must be one of the exact locked options for its question
 * (ANSWER_OPTIONS from questions.ts) — an unknown option string is a 400 (F1.4).
 * Missing/mis-typed fields are 400 (F1.1/F1.3). Unknown extra keys are stripped,
 * not rejected (F1.7) — zod objects strip by default. Consent is validated in the
 * route so we can return the exact "consent required" message (F1.2).
 */
import { z } from 'zod';
import { ANSWER_OPTIONS, RESPONDENT_OPTIONS } from './questions';

const answersSchema = z.object({
	target_score: z.enum(ANSWER_OPTIONS.target_score),
	grade: z.enum(ANSWER_OPTIONS.grade),
	test_date: z.enum(ANSWER_OPTIONS.test_date),
	sat_history: z.enum(ANSWER_OPTIONS.sat_history),
	q5: z.enum(ANSWER_OPTIONS.q5),
	q6: z.enum(ANSWER_OPTIONS.q6),
	q7: z.enum(ANSWER_OPTIONS.q7),
	q8: z.enum(ANSWER_OPTIONS.q8),
	q9: z.enum(ANSWER_OPTIONS.q9),
	q10: z.enum(ANSWER_OPTIONS.q10),
	q11: z.enum(ANSWER_OPTIONS.q11),
	q12: z.enum(ANSWER_OPTIONS.q12),
	hours_per_week: z.enum(ANSWER_OPTIONS.hours_per_week),
	timing: z.enum(ANSWER_OPTIONS.timing),
	review_mistakes: z.enum(ANSWER_OPTIONS.review_mistakes),
	prep_status: z.enum(ANSWER_OPTIONS.prep_status),
	worried_about: z.enum(ANSWER_OPTIONS.worried_about),
});

const contactSchema = z.object({
	first_name: z.string().trim().min(1),
	whatsapp: z.string().trim().min(1),
	school: z.string().trim().min(1).optional(),
	respondent_type: z.enum(RESPONDENT_OPTIONS),
	// consent must be a boolean here; the route enforces === true (F1.2, exact message).
	consent: z.boolean(),
});

export const submissionSchema = z.object({
	session_id: z.string().trim().min(1),
	source: z.string().optional(),
	completion_time_sec: z.number().int().nonnegative().optional(),
	answers: answersSchema,
	contact: contactSchema,
});

export type Submission = z.infer<typeof submissionSchema>;
export type SubmissionAnswers = Submission['answers'];
export type SubmissionContact = Submission['contact'];

// ── PATCH /api/admin/leads/:id — manual fields only (BACKEND_SPEC §1 US-5, PRD §10) ──
// These sets mirror the `diagnostics` schema enums exactly.
export const FOLLOWUP_STATUSES = ['None', 'Msg1 sent', 'Msg2 sent', 'Replied', 'Not interested'] as const;
export const OUTCOMES = ['-', 'Enrolled $80', 'Enrolled $130', 'Lost'] as const;

/**
 * The ONLY fields an admin may edit. `.strict()` makes any other key — a computed field,
 * an answer, or an unknown field — a validation error (F5.1), so the score/profile/answers
 * are immutable via the API. A bad enum value is rejected (F5.2), and at least one field
 * must be present.
 */
export const leadUpdateSchema = z
	.object({
		result_sent: z.boolean().optional(),
		followup_status: z.enum(FOLLOWUP_STATUSES).optional(),
		outcome: z.enum(OUTCOMES).optional(),
		notes: z.string().max(5000).nullable().optional(),
	})
	.strict()
	.refine((o) => Object.keys(o).length > 0, { message: 'no updatable fields provided' });

export type LeadUpdate = z.infer<typeof leadUpdateSchema>;
