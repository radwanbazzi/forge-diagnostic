/**
 * Builds the student-facing `result_payload` from the computed fields (PRD §8).
 * Pure: environment-specific values (WhatsApp number, Whish link) are passed in.
 *
 * Hard rule (US-6 / F6.1): the output must NEVER contain an unfilled `[bracket]`
 * or the string "undefined". Every slot is built from known values with a safe
 * fallback, and the archetype/timeline maps are exhaustive over the union types
 * (TypeScript enforces completeness of the `Record<...>` maps below).
 */
import type { Answers, Computed } from '../types';

type Archetype = Computed['archetype'];
type Timeline = Computed['timeline_verdict'];

export interface ResultPayload {
	band: { range: string; confidence: string; sub: string };
	profile: { archetype: string; statement: string; meaning: string };
	reframe: { kind: 'reframe' | 'affirm'; text: string };
	section_read: string;
	top_fixes: string[];
	timeline: { verdict: string; line: string };
	recommendation: { program: string; text: string; guarantee: string | null };
	cta: { whatsapp_prefill: string; whatsapp_url: string | null; whish_note: string; whish_link: string | null };
	meta: { first_name: string; overall_band: string; archetype: string; lead_status: string; recommended_program: string };
}

interface ArchetypeInfo {
	meaning: string;
	/** The real bottleneck, phrased for the reframe sentence. Empty = no single bottleneck. */
	bottleneck: string;
	fixes: [string, string, string];
	/** worried_about values that AGREE with this archetype (→ affirm instead of reframe). */
	worriesThatMatch: string[];
}

const ARCHETYPE_INFO: Record<Archetype, ArchetypeInfo> = {
	'Time-Pressured': {
		meaning: 'the clock, not the content.',
		bottleneck: 'pacing — you are running out of time, not out of knowledge',
		fixes: [
			'Pacing drills to build a steady, repeatable rhythm',
			'A skip-and-return system so hard questions stop stealing easy points',
			'Full timed sections until the clock stops rattling you',
		],
		worriesThatMatch: ['Running out of time'],
	},
	'Lopsided (Math-weak)': {
		meaning: 'Math is dragging down an otherwise solid Reading & Writing score.',
		bottleneck: 'Math specifically',
		fixes: [
			'Put about 70% of your study time into Math',
			'Targeted concept work on your weakest Math topics',
			'Keep Reading & Writing steady with light maintenance',
		],
		worriesThatMatch: ['Math'],
	},
	'Lopsided (R&W-weak)': {
		meaning: 'Reading & Writing is dragging down an otherwise solid Math score.',
		bottleneck: 'Reading & Writing specifically',
		fixes: [
			'Put about 70% of your study time into Reading & Writing',
			'Targeted reading and grammar practice',
			'Keep Math steady with light maintenance',
		],
		worriesThatMatch: ['Reading', 'Writing & grammar'],
	},
	'Shaky Grammarian': {
		meaning: 'your reading is fine — punctuation and grammar rules are leaking points.',
		bottleneck: 'grammar and punctuation rules',
		fixes: [
			'Drill the handful of boundary and punctuation rules',
			'Master transition words and logical connectors',
			'Do timed Reading & Writing sections',
		],
		worriesThatMatch: ['Writing & grammar'],
	},
	'Plateaued Retaker': {
		meaning: 'you are stuck converting near-misses into points, not lacking the basics.',
		bottleneck: 'converting near-misses into points',
		fixes: [
			'Analyze your mistake patterns to see what actually costs you points',
			'Take a full timed mock to pressure-test where you stand',
			'Targeted work on your single weakest area',
		],
		worriesThatMatch: [],
	},
	'Untested Unknown': {
		meaning: 'there is not enough data to pinpoint it yet — totally normal this early.',
		bottleneck: '',
		fixes: [
			'Take one full timed mock to set a real baseline',
			'Set a target score and a test date',
			'Build a simple, repeatable weekly study routine',
		],
		worriesThatMatch: [],
	},
};

const TIMELINE_LINE: Record<Timeline, string> = {
	Aggressive: 'a real jump in a short window — every week counts, so a tight plan matters.',
	'Tight but doable': 'not much runway, but a focused plan can still get you there.',
	Reasonable: 'enough time to build real gains if you start now.',
	Comfortable: 'a comfortable runway — steady weekly work will compound.',
	'Early / lots of runway': 'lots of runway — the big win now is a baseline and a weekly habit.',
};

/** Reader-friendly label for a worried_about value (used inside the reframe sentence). */
const WORRIED_LABEL: Record<string, string> = {
	Reading: 'Reading',
	'Writing & grammar': 'Writing & grammar',
	Math: 'Math',
	'Running out of time': 'running out of time',
	'Honestly, all of it': 'a bit of everything',
};

function sectionRead(mathRaw: number, rwRaw: number): string {
	const scores = `(Math ${mathRaw}/8, Reading & Writing ${rwRaw}/8)`;
	const diff = mathRaw - rwRaw;
	if (Math.abs(diff) <= 1) return `Your Math and Reading & Writing look fairly balanced right now ${scores}.`;
	if (diff > 0) return `Right now your Math is ahead of your Reading & Writing ${scores}.`;
	return `Right now your Reading & Writing is ahead of your Math ${scores}.`;
}

/** Digits-only phone for a wa.me link (never emit wa.me/undefined — US-2/F2.1). */
function waDigits(n: string): string {
	return n.replace(/\D/g, '');
}

export interface ResultCopyConfig {
	whatsappNumber?: string | null;
	whishLink?: string | null;
}

export function buildResultPayload(
	computed: Computed,
	answers: Answers,
	firstNameRaw: string,
	cfg: ResultCopyConfig = {},
): ResultPayload {
	const info = ARCHETYPE_INFO[computed.archetype];
	const firstName = firstNameRaw.trim() || 'there';

	// The reframe (§8): affirm when self-report matches the data, else reframe.
	let reframe: ResultPayload['reframe'];
	if (computed.archetype === 'Untested Unknown') {
		reframe = {
			kind: 'affirm',
			text: 'With no timed data yet, the fastest move is a baseline mock — it turns guesswork into a clear plan.',
		};
	} else if (info.worriesThatMatch.includes(answers.worried_about)) {
		reframe = {
			kind: 'affirm',
			text: `You already sense it: ${info.bottleneck} is exactly where your points are. Good instinct — that focus will pay off.`,
		};
	} else {
		const worried = WORRIED_LABEL[answers.worried_about] ?? answers.worried_about;
		reframe = {
			kind: 'reframe',
			text: `You told us ${worried} worried you most — but your answers point to ${info.bottleneck}. That is actually good news: it is faster to fix.`,
		};
	}

	// Recommendation (§8): tie to the bottleneck; guarantee only for the Accelerator.
	const focus = info.bottleneck || 'your baseline and weekly routine';
	const recommendation: ResultPayload['recommendation'] =
		computed.recommended_program === '$130 SAT Accelerator'
			? {
					program: computed.recommended_program,
					text: `The $130 SAT Accelerator is the right fit — its coaching zeroes in on ${focus}, with weekly timed practice to lock in gains.`,
					guarantee: 'It includes our Score Improvement Guarantee, measured against your Week-1 full mock.',
				}
			: {
					program: computed.recommended_program,
					text: 'The $80 SAT Essentials is the right starting point — it builds your foundation and gives you a clear baseline to work from.',
					guarantee: null,
				};

	// Target-aware framing (§8): when the student named a target AND their estimate falls
	// short of it, name the gap explicitly and position Forge as the bridge. This is COPY
	// ONLY — it reads the already-computed band/current_mid/gap and NEVER changes them, so
	// two identical answer sets with different targets still get the same band. "Not sure"
	// (target_num 0 → gap null) or an estimate already at/above target → no gap line.
	if (computed.target_num > 0 && computed.gap !== null && computed.gap > 0) {
		recommendation.text += ` You're aiming for ${computed.target_num}, and your estimate sits around ${computed.current_mid}. That's a ${computed.gap}-point gap — exactly the kind of distance a structured Forge plan is built to close.`;
	}

	const prefill = `Hi Forge! I just finished the SAT diagnostic. I'm ${firstName}, my profile is "${computed.archetype}" and my estimated range is ${computed.overall_band}. Can you tell me about the ${computed.recommended_program}?`;

	return {
		band: {
			range: computed.overall_band,
			confidence: computed.confidence,
			sub: `${computed.confidence} confidence — a full timed mock narrows this considerably.`,
		},
		profile: {
			archetype: computed.archetype,
			statement: `You're ${computed.archetype}.`,
			meaning: info.meaning,
		},
		reframe,
		section_read: sectionRead(computed.math_raw, computed.rw_raw),
		top_fixes: [...info.fixes],
		timeline: { verdict: computed.timeline_verdict, line: TIMELINE_LINE[computed.timeline_verdict] },
		recommendation,
		cta: {
			whatsapp_prefill: prefill,
			whatsapp_url: cfg.whatsappNumber ? `https://wa.me/${waDigits(cfg.whatsappNumber)}?text=${encodeURIComponent(prefill)}` : null,
			whish_note: 'Payment is quick via Whish.',
			whish_link: cfg.whishLink ?? null,
		},
		meta: {
			first_name: firstName,
			overall_band: computed.overall_band,
			archetype: computed.archetype,
			lead_status: computed.lead_status,
			recommended_program: computed.recommended_program,
		},
	};
}
