/**
 * Lead scoring + program recommendation (PRD §7.9–7.10).
 *
 * Split out from scoring.ts (per BACKEND_SPEC §2's `lib/leadScore.ts`) to keep the
 * scoring module focused on the score/profile computation. Pure functions, no I/O.
 *
 * All matching is by stable keyword so it is robust to incidental option wording.
 * The exact option phrases the engine keys on are documented per function.
 */
import type { Answers, ScoringContact } from '../types';

/** §7.9 urgency from test_date: "Within 8 weeks" = 3 · "2-4 months" = 2 · else = 1. */
function urgencyScore(testDate: string): number {
	const t = testDate.toLowerCase();
	if (t.includes('8 week')) return 3;
	if (t.includes('2-4 month')) return 2;
	return 1;
}

/** §7.9 gap sub-score: null → 1 · ≥150 → 3 · ≥80 → 2 · else 1. */
function gapScore(gap: number | null): number {
	if (gap === null) return 1;
	if (gap >= 150) return 3;
	if (gap >= 80) return 2;
	return 1;
}

/** §7.9 hours component: >8 = 2 · 5-8 = 1 · 2-4 = 1 · <2 = 0. */
function hoursScore(hoursPerWeek: string): number {
	const h = hoursPerWeek.toLowerCase();
	if (h.includes('more than 8') || h.includes('8+') || h.includes('> 8')) return 2;
	if (h.includes('5-8')) return 1;
	if (h.includes('2-4')) return 1;
	return 0; // "Less than 2 hours"
}

/** §7.9 prep component: "Not really"/"On my own" = +1 · "school" = +0.5 · "another tutor" = 0. */
function prepScore(prepStatus: string): number {
	const p = prepStatus.toLowerCase();
	if (p.includes('not really') || p.includes('on my own')) return 1;
	if (p.includes('school')) return 0.5;
	return 0; // "With another tutor / center", or anything else
}

/** §7.9 seriousness (capped at 3): hours + target-set(+1 unless "Not sure") + prep. */
function seriousnessScore(answers: Answers): number {
	const targetSet = answers.target_score.toLowerCase().includes('not sure') ? 0 : 1;
	return Math.min(3, hoursScore(answers.hours_per_week) + targetSet + prepScore(answers.prep_status));
}

/** §7.9 contact (capped at 2): whatsapp present +1, school present +1. */
function contactScore(contact: ScoringContact): number {
	const hasWhatsapp = typeof contact.whatsapp === 'string' && contact.whatsapp.trim() !== '';
	const hasSchool = typeof contact.school === 'string' && contact.school.trim() !== '';
	return Math.min(2, (hasWhatsapp ? 1 : 0) + (hasSchool ? 1 : 0));
}

/** §7.9 total lead score (0–11). May be fractional (prep "school" contributes +0.5). */
export function computeLeadScore(answers: Answers, contact: ScoringContact, gap: number | null): number {
	return urgencyScore(answers.test_date) + gapScore(gap) + seriousnessScore(answers) + contactScore(contact);
}

/**
 * §7.9 status thresholds: HOT ≥ 8 · COLD ≤ 4 · WARM otherwise.
 * (The spec's "WARM 5-7" describes the typical band; scores can be fractional,
 * so WARM is defined as the open interval between the COLD and HOT thresholds.)
 */
export function leadStatus(score: number): 'HOT' | 'WARM' | 'COLD' {
	if (score >= 8) return 'HOT';
	if (score <= 4) return 'COLD';
	return 'WARM';
}

/** §7.10 program: COLD or "Untested Unknown" → $80 Essentials; else $130 Accelerator. */
export function recommendProgram(
	status: 'HOT' | 'WARM' | 'COLD',
	archetype: string,
): '$80 SAT Essentials' | '$130 SAT Accelerator' {
	if (status === 'COLD' || archetype === 'Untested Unknown') return '$80 SAT Essentials';
	return '$130 SAT Accelerator';
}
