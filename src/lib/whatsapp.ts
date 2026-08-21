/**
 * Assembles the "copy WhatsApp message" for a lead (PRD §10 / US-6): a ready-to-paste
 * result summary the founder sends to the student.
 *
 * F6.1: every slot has a safe fallback — the message can never contain an unfilled
 * `[bracket]` or the string "undefined", even if the parsed payload is missing pieces.
 * Core facts come from the (non-null) lead columns; the parsed payload only enriches.
 */
import type { Diagnostic } from '../db/schema';
import type { ResultPayload } from './resultCopy';

export function buildFounderWhatsAppMessage(lead: Diagnostic, payload?: ResultPayload | null): string {
	const name = (lead.first_name ?? '').trim() || 'there';
	const band = (lead.overall_band ?? '').trim() || 'your estimated range';
	const confidence = (lead.confidence ?? '').trim() || 'moderate';
	const profile = (lead.archetype ?? '').trim() || 'your profile';
	const program = (lead.recommended_program ?? '').trim() || 'the right Forge program for you';
	const meaning = payload?.profile?.meaning?.trim();
	const topFix = payload?.top_fixes?.[0]?.trim();

	const lines = [
		`Hi ${name}! Here's your Forge SAT diagnostic result 👇`,
		'',
		`📊 Estimated SAT range: ${band} (${confidence} confidence)`,
		`🎯 Your profile: ${profile}${meaning ? ` — ${meaning}` : ''}`,
	];
	if (topFix) lines.push(`🔧 First thing to work on: ${topFix}`);
	lines.push(`🚀 Recommended next step: ${program}`);
	lines.push('', `Want to turn this into a plan and hit your target? Just reply here — payment is quick via Whish.`);

	return lines.join('\n');
}
