/**
 * Lead scoring + program recommendation (PRD §7.9–7.10), reproducing the reference
 * spreadsheet's AL/AM/AN/AO/AP/AQ/AK formulas exactly (Tab ③).
 *
 * Split out from scoring.ts (per BACKEND_SPEC §2). Pure functions, no I/O.
 * Matching folds en/em dashes to hyphens via normalizeOption (see normalize.ts),
 * so it matches the locked option wording ("5–8", "2–4 months", "Not sure yet", …).
 */
import type { Answers, ScoringContact } from '../types';
import { normalizeOption } from './normalize';

/** §7.9 urgency from test_date: "Within 8 weeks" = 3 · "2–4 months" = 2 · else = 1 (ref AL2). */
function urgencyScore(testDate: string): number {
	const t = normalizeOption(testDate);
	if (t.includes('8 week')) return 3;
	if (t.includes('2-4 month')) return 2;
	return 1;
}

/** §7.9 gap sub-score: null → 1 · ≥150 → 3 · ≥80 → 2 · else 1 (ref AM2). */
function gapScore(gap: number | null): number {
	if (gap === null) return 1;
	if (gap >= 150) return 3;
	if (gap >= 80) return 2;
	return 1;
}

/** §7.9 hours component: "More than 8" = 2 · "5–8" = 1 · "2–4" = 1 · "Less than 2" = 0 (ref AN2 h). */
function hoursScore(hoursPerWeek: string): number {
	const h = normalizeOption(hoursPerWeek);
	if (h.includes('more than 8')) return 2;
	if (h.includes('5-8')) return 1;
	if (h.includes('2-4')) return 1;
	return 0;
}

/** §7.9 prep component: "Not really"/"On my own" = +1 · "school" = +0.5 · else 0 (ref AN2 p). */
function prepScore(prepStatus: string): number {
	const p = normalizeOption(prepStatus);
	if (p.includes('not really') || p.includes('on my own')) return 1;
	if (p.includes('school')) return 0.5;
	return 0;
}

/** §7.9 seriousness (capped at 3): hours + target-set(+1 unless "Not sure") + prep (ref AN2). */
function seriousnessScore(answers: Answers): number {
	const targetSet = normalizeOption(answers.target_score).includes('not sure') ? 0 : 1;
	return Math.min(3, hoursScore(answers.hours_per_week) + targetSet + prepScore(answers.prep_status));
}

/** §7.9 contact (capped at 2): whatsapp present +1, school present +1 (ref AO2). */
function contactScore(contact: ScoringContact): number {
	const hasWhatsapp = typeof contact.whatsapp === 'string' && contact.whatsapp.trim() !== '';
	const hasSchool = typeof contact.school === 'string' && contact.school.trim() !== '';
	return Math.min(2, (hasWhatsapp ? 1 : 0) + (hasSchool ? 1 : 0));
}

/** §7.9 total lead score (0–11); may be fractional (prep "school" adds +0.5) (ref AP2). */
export function computeLeadScore(answers: Answers, contact: ScoringContact, gap: number | null): number {
	return urgencyScore(answers.test_date) + gapScore(gap) + seriousnessScore(answers) + contactScore(contact);
}

/** §7.9 status: HOT ≥ 8 · WARM ≥ 5 · COLD < 5 (ref AQ2: IF(AP>=8,"HOT",IF(AP>=5,"WARM","COLD"))). */
export function leadStatus(score: number): 'HOT' | 'WARM' | 'COLD' {
	if (score >= 8) return 'HOT';
	if (score >= 5) return 'WARM';
	return 'COLD';
}

/** §7.10 program: COLD or "Untested Unknown" → $80 Essentials; else $130 Accelerator (ref AK2). */
export function recommendProgram(
	status: 'HOT' | 'WARM' | 'COLD',
	archetype: string,
): '$80 SAT Essentials' | '$130 SAT Accelerator' {
	if (status === 'COLD' || archetype === 'Untested Unknown') return '$80 SAT Essentials';
	return '$130 SAT Accelerator';
}
