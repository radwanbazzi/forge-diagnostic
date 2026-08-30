/**
 * Drizzle schema for D1 (SQLite) — BACKEND_SPEC §3 / PRD §6.
 *
 * SQLite type notes: booleans are stored as integer 0/1, ids as text (uuid via
 * crypto.randomUUID()), JSON as text, timestamps as integer unix-ms. The
 * `text(..., { enum: [...] })` form narrows the TypeScript type only (SQLite has
 * no native enum / CHECK is not added); the listed values are the exact strings
 * the scoring engine will produce (PRD §7–§8).
 */
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per completed diagnostic = one auto-scored lead. */
export const diagnostics = sqliteTable('diagnostics', {
	// identity + meta
	id: text('id').primaryKey(), // uuid (crypto.randomUUID())
	session_id: text('session_id').notNull().unique(), // client-generated per attempt; UNIQUE for dedupe upsert (US-1.6)
	created_at: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()), // unix ms
	source: text('source'), // UTM/source (nullable)
	completion_time_sec: integer('completion_time_sec'), // nullable

	// answers — Q1–Q4 (raw option strings)
	target_score: text('target_score').notNull(),
	grade: text('grade').notNull(),
	test_date: text('test_date').notNull(),
	sat_history: text('sat_history').notNull(),

	// answers — Q5–Q12 (scored questions, e.g. "C) 300")
	q5: text('q5').notNull(),
	q6: text('q6').notNull(),
	q7: text('q7').notNull(),
	q8: text('q8').notNull(),
	q9: text('q9').notNull(),
	q10: text('q10').notNull(),
	q11: text('q11').notNull(),
	q12: text('q12').notNull(),

	// answers — Q13–Q17 (study habits)
	hours_per_week: text('hours_per_week').notNull(),
	timing: text('timing').notNull(),
	review_mistakes: text('review_mistakes').notNull(),
	prep_status: text('prep_status').notNull(),
	worried_about: text('worried_about').notNull(),

	// contact
	first_name: text('first_name').notNull(),
	whatsapp: text('whatsapp').notNull(),
	school: text('school'), // nullable (the only optional question, Q20)
	respondent_type: text('respondent_type', { enum: ['student', 'parent'] }).notNull(),
	consent: integer('consent').notNull(), // 0/1, must be 1 to submit

	// computed (snapshot at submit — never recomputed on read, PRD F12)
	math_raw: integer('math_raw').notNull(),
	rw_raw: integer('rw_raw').notNull(),
	overall_band: text('overall_band').notNull(), // e.g. "1040-1200"
	confidence: text('confidence', { enum: ['Moderate', 'Low-Moderate', 'Low'] }).notNull(),
	archetype: text('archetype', {
		enum: [
			'Time-Pressured',
			'Lopsided (Math-weak)',
			'Lopsided (R&W-weak)',
			'Shaky Grammarian',
			'Plateaued Retaker',
			'Untested Unknown',
		],
	}).notNull(),
	target_num: integer('target_num').notNull(),
	current_mid: integer('current_mid').notNull(),
	gap: integer('gap'), // nullable (null when target is "Not sure")
	timeline_verdict: text('timeline_verdict', {
		enum: ['Aggressive', 'Tight but doable', 'Reasonable', 'Comfortable', 'Early / lots of runway'],
	}).notNull(),
	recommended_program: text('recommended_program', { enum: ['$80 SAT Essentials', '$130 SAT Accelerator'] }).notNull(),
	lead_score: real('lead_score').notNull(),
	lead_status: text('lead_status', { enum: ['HOT', 'WARM', 'COLD'] }).notNull(),
	result_payload: text('result_payload').notNull(), // JSON string — the exact rendered result

	// admin (manual, editable in the dashboard)
	result_sent: integer('result_sent').notNull().default(0),
	followup_status: text('followup_status', { enum: ['None', 'Msg1 sent', 'Msg2 sent', 'Replied', 'Not interested'] })
		.notNull()
		.default('None'),
	outcome: text('outcome', { enum: ['-', 'Enrolled $80', 'Enrolled $130', 'Lost'] })
		.notNull()
		.default('-'),
	notes: text('notes'), // nullable
});

/** Lightweight analytics events (PRD §11 / BACKEND_SPEC §3). */
export const events = sqliteTable('events', {
	id: text('id').primaryKey(), // uuid
	session_id: text('session_id').notNull(),
	created_at: integer('created_at')
		.notNull()
		.$defaultFn(() => Date.now()), // unix ms
	type: text('type', { enum: ['start', 'advance', 'contact_reached', 'completed', 'whatsapp_clicked'] }).notNull(),
	question_index: integer('question_index'), // nullable (set for 'advance')
	meta: text('meta'), // nullable JSON string
});

export type Diagnostic = typeof diagnostics.$inferSelect;
export type NewDiagnostic = typeof diagnostics.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
