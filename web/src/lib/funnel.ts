/**
 * The drop-off ladder (F-M3b, design spec §6.1) — pure, no React, no fetching.
 *
 * The analytics endpoint returns a SPARSE list: only question numbers that have at least
 * one 'advance' event appear. This module expands that into the full 19-step ladder the
 * screen draws — Q1…Q17, the contact gate, then completed — joining each question to its
 * real text so the owner reads "Q8 — the vocabulary-in-context one", never
 * "question_index: 7".
 *
 * ⚠️ Boundary rule (CLAUDE.md): src/lib/questions.ts is the ONLY server module anything
 * under web/ may import. It is explicitly browser-safe — question text and options, no
 * answer key. Never reach for answerKey.ts from here.
 *
 * Two properties every consumer relies on:
 *
 *   • THE BOUNDARY IS EXPLICIT. `quitInQuestions` (started, never reached the contact
 *     screen) and `quitAtContactGate` (reached it, never submitted) are counted separately
 *     because they are different problems: a hard or boring question versus a student who
 *     will not hand over a phone number.
 *
 *   • THE NUMBERS ARE HONEST. Beacons are fire-and-forget `keepalive` posts; one can be
 *     dropped by a closing tab or a flaky network, and the rate limiter drops floods. So
 *     the counts are NOT guaranteed to fall monotonically. Every loss is clamped at zero
 *     and the baseline falls back to the largest observed step, so the screen can never
 *     show "-5 quit here" or a bar past 100%.
 */
import { QUESTIONS } from '../../../src/lib/questions';

/** Sections 1-3 are one question per screen; section 4 is the single contact screen. */
export type QuestionSection = 1 | 2 | 3;

export interface QuestionStep {
	/** 1-based question number, matching the `question_index` on an 'advance' event. */
	n: number;
	/** Short label for the bar: "Q1". */
	label: string;
	/** The real question text, straight from the shared config. */
	detail: string;
	/** A few words naming what the question is about, for headlines: "the vocabulary one". */
	topic: string;
	section: QuestionSection;
}

/**
 * A short, human name for each question, so a headline can read "7 of 30 quit at Q8 — the
 * vocabulary one" instead of quoting a 40-word prompt. Presentation only: these live here
 * rather than in src/lib/questions.ts, which is a locked verbatim transcription of the
 * source spreadsheet and must not grow display fields. A test asserts one exists for all 17.
 */
const TOPICS: Record<number, string> = {
	1: 'their target score',
	2: 'their grade',
	3: 'their test date',
	4: 'their SAT history',
	5: 'the phone-plan maths one',
	6: 'the transition-word one',
	7: 'the quadratic one',
	8: 'the vocabulary one',
	9: 'the percentages one',
	10: 'the punctuation one',
	11: 'the trigonometry one',
	12: 'the reading-inference one',
	13: 'hours per week',
	14: 'working under time pressure',
	15: 'reviewing mistakes',
	16: 'how they prepare now',
	17: 'what worries them most',
};

/**
 * The 17 one-per-screen questions, in order — the same derivation DiagnosticFlow uses
 * (`QUESTIONS.filter(q => q.section !== 4)`). Exported so the empty state can draw the
 * whole ladder before a single student has taken the quiz.
 */
export const QUESTION_STEPS: readonly QuestionStep[] = QUESTIONS.filter((q) => q.section !== 4).map((q) => ({
	n: q.n,
	label: `Q${q.n}`,
	detail: q.prompt,
	topic: TOPICS[q.n] ?? q.field,
	section: q.section as QuestionSection,
}));

/** What each section is called on screen. */
export const SECTION_LABELS: Record<QuestionSection, string> = {
	1: 'About you & your goal',
	2: 'Quick skills check',
	3: 'How you study',
};

export type FunnelStepKind = 'question' | 'contact-gate' | 'completed';

export interface FunnelStep {
	/** Stable React key: "q1"…"q17", "contact", "completed". */
	key: string;
	kind: FunnelStepKind;
	/** Present only on question steps. */
	n?: number;
	section?: QuestionSection;
	/** Short label for the bar. */
	label: string;
	/** The question text, or a plain-language line for the two non-question steps. */
	detail: string;
	/** A few words naming the step, for headlines and callouts. */
	topic: string;
	/** Distinct sessions that reached this step. */
	reached: number;
	/** Reached this step and never reached the next one. Always >= 0; 0 on the last step. */
	lost: number;
	/** `reached` as a share of the baseline, 0..1. Never above 1. */
	share: number;
	/** One of the three biggest losses in the funnel (only ever set when there is data). */
	isBigLoss: boolean;
}

export interface FunnelSummary {
	/** Everyone who opened the quiz. Falls back to the largest step if the 'start' beacon was lost. */
	started: number;
	/** Reached the section-4 contact screen. */
	reachedContact: number;
	/** Submitted and saw their result — these are the rows in the leads table. */
	completed: number;
	/** Quit somewhere in Q1-Q17 and never saw the contact screen. */
	quitInQuestions: number;
	/** Saw the contact screen and never submitted — the "won't give a number" problem. */
	quitAtContactGate: number;
	/** False when no student has generated a single event yet. */
	hasData: boolean;
}

export interface Funnel {
	steps: FunnelStep[];
	summary: FunnelSummary;
}

/** Only the analytics fields this module reads — keeps it testable without the whole response. */
interface FunnelInput {
	started: number;
	contact_reached: number;
	completed: number;
	funnel_by_question: Array<{ question_index: number; count: number }>;
}

/** How many biggest losses to highlight (design spec §6.1). */
const TOP_LOSS_COUNT = 3;

const clamp0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function buildFunnel(a: FunnelInput): Funnel {
	// Sparse -> dense. A question with no events at all is a real zero, not a missing bar.
	const byQuestion = new Map<number, number>();
	for (const row of a.funnel_by_question) byQuestion.set(row.question_index, clamp0(row.count));

	const reachedPerStep: number[] = [
		...QUESTION_STEPS.map((q) => byQuestion.get(q.n) ?? 0),
		clamp0(a.contact_reached),
		clamp0(a.completed),
	];

	// The baseline is what 100% means. Normally that is `started`, but a dropped start
	// beacon would otherwise push later bars past 100% — so take the largest thing we saw.
	const started = Math.max(clamp0(a.started), ...reachedPerStep);

	const steps: FunnelStep[] = reachedPerStep.map((reached, i) => {
		const next = reachedPerStep[i + 1];
		const lost = next === undefined ? 0 : clamp0(reached - next);
		const share = started > 0 ? reached / started : 0;

		if (i < QUESTION_STEPS.length) {
			const q = QUESTION_STEPS[i];
			return { key: `q${q.n}`, kind: 'question', n: q.n, section: q.section, label: q.label, detail: q.detail, topic: q.topic, reached, lost, share, isBigLoss: false };
		}
		if (i === QUESTION_STEPS.length) {
			return {
				key: 'contact',
				kind: 'contact-gate',
				label: 'Contact details',
				detail: 'We ask for a first name and a WhatsApp number.',
				topic: 'the moment you ask for a phone number',
				reached,
				lost,
				share,
				isBigLoss: false,
			};
		}
		return {
			key: 'completed',
			kind: 'completed',
			label: 'Saw their result',
			detail: 'Submitted, scored, and shown their SAT range.',
			topic: 'the result screen',
			reached,
			lost,
			share,
			isBigLoss: false,
		};
	});

	// Highlight the three biggest losses. Ties are broken by position, so the earliest of
	// two equal drops wins — that is the one the owner should look at first.
	const biggest = steps
		.map((s, i) => ({ i, lost: s.lost }))
		.filter((s) => s.lost > 0)
		.sort((x, y) => y.lost - x.lost || x.i - y.i)
		.slice(0, TOP_LOSS_COUNT);
	for (const b of biggest) steps[b.i].isBigLoss = true;

	const reachedContact = steps[QUESTION_STEPS.length].reached;
	const completed = steps[steps.length - 1].reached;

	return {
		steps,
		summary: {
			started,
			reachedContact,
			completed,
			quitInQuestions: clamp0(started - reachedContact),
			quitAtContactGate: clamp0(reachedContact - completed),
			hasData: started > 0,
		},
	};
}

/**
 * The one-line headline over the funnel: "7 of 30 quit at Q8 — the vocabulary one".
 * Returns null when there is nothing worth calling out, so the caller renders nothing
 * rather than an empty sentence.
 */
export function biggestDropSentence(funnel: Funnel): string | null {
	const worst = funnel.steps.reduce<FunnelStep | null>((best, s) => (s.lost > (best?.lost ?? 0) ? s : best), null);
	if (!worst || worst.lost === 0) return null;
	const where = worst.kind === 'question' ? `at ${worst.label} — ${worst.topic}` : `at ${worst.topic}`;
	return `${worst.lost} of ${funnel.summary.started} quit ${where}.`;
}

/** "62%" from 0.6234. Whole numbers only — this is a read-at-a-glance screen. */
export function percent(share: number): string {
	if (!Number.isFinite(share) || share <= 0) return '0%';
	return `${Math.round(share * 100)}%`;
}
