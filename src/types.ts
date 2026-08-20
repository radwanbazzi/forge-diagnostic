/**
 * Shared types for the Forge SAT Diagnostic Worker.
 *
 * `Bindings` describes the resources and environment variables the Worker
 * receives at runtime (declared in wrangler.jsonc + .dev.vars). Hono exposes
 * these on `c.env`. After changing bindings, run `npm run cf-typegen` to keep
 * the generated global types (worker-configuration.d.ts) in sync.
 *
 * `Answers` / `Computed` are the scoring engine's input and output (PRD §7).
 * `Computed` is derived from the Drizzle schema so it stays exactly in step with
 * the `diagnostics` computed columns — a single source of truth.
 */
import type { NewDiagnostic } from './db/schema';

/** Cloudflare resource + env bindings available on `c.env`. */
export interface Bindings {
	/** D1 (SQLite) database — the only datastore. Never exposed to the browser. */
	DB: D1Database;
	/** Forge WhatsApp number used to build the pre-filled wa.me CTA link. */
	WHATSAPP_NUMBER: string;
	/** Whish payment link shown on the result screen. */
	WHISH_LINK: string;
}

/** Hono generic env: binds `c.env` to our `Bindings`. */
export interface HonoEnv {
	Bindings: Bindings;
}

/**
 * Raw answer option strings for the scored/among-22 questions (PRD §6 / §7).
 * Values are the exact option text the student selected (e.g. "C) 300"); scoring
 * matches on stable keywords/leading letters, not on incidental wording.
 */
export interface Answers {
	target_score: string; // Q1
	grade: string; // Q2 (not used by scoring)
	test_date: string; // Q3
	sat_history: string; // Q4
	q5: string;
	q6: string;
	q7: string;
	q8: string;
	q9: string;
	q10: string;
	q11: string;
	q12: string;
	hours_per_week: string; // Q13
	timing: string; // Q14
	review_mistakes: string; // Q15 (not used by scoring)
	prep_status: string; // Q16
	worried_about: string; // Q17 (used by §8 result copy, not §7 scoring)
}

/** Contact fields the scoring engine reads (their presence affects lead score, §7.9). */
export interface ScoringContact {
	whatsapp?: string | null;
	school?: string | null;
}

/** Input to the pure scoring function: the answers plus the contact fields §7.9 needs. */
export interface ScoreInput {
	answers: Answers;
	contact: ScoringContact;
}

/**
 * The §7 computed snapshot — exactly the computed columns of `diagnostics`.
 * Derived from the schema's insert type so the union values (archetype,
 * confidence, program, status, timeline) can never drift from the database.
 */
export type Computed = Required<
	Pick<
		NewDiagnostic,
		| 'math_raw'
		| 'rw_raw'
		| 'overall_band'
		| 'confidence'
		| 'archetype'
		| 'target_num'
		| 'current_mid'
		| 'timeline_verdict'
		| 'recommended_program'
		| 'lead_score'
		| 'lead_status'
	>
> & { gap: number | null };
