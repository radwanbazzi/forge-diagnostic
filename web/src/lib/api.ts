/**
 * Front-end API + analytics helpers for the diagnostic flow (F-M2).
 *
 * Same-origin calls: in production one Worker serves both the static site and /api/*;
 * in local dev `npm run dev` builds web/ and `wrangler dev` serves both on
 * http://localhost:8787 — so a relative "/api/..." path always reaches the Worker,
 * with no CORS and no proxy.
 *
 * ⚠️ No scoring logic or answer key lives here (or anywhere under web/). The result is
 * computed entirely server-side and returned whole; the client only renders it. The
 * `ResultPayload` type below is a hand-kept MIRROR of the server's shape
 * (src/lib/resultCopy.ts) — defined locally on purpose so no server module (and thus
 * nothing that could reach answerKey.ts) is ever pulled into the browser bundle.
 */

/** The exact shape the server returns in `result_payload` (mirrors src/lib/resultCopy.ts). */
export interface ResultPayload {
	band: { range: string; confidence: string; sub: string };
	profile: { archetype: string; statement: string; meaning: string };
	reframe: { kind: 'reframe' | 'affirm'; text: string };
	section_read: string;
	top_fixes: string[];
	timeline: { verdict: string; line: string };
	recommendation: { program: string; text: string; guarantee: string | null };
	cta: {
		whatsapp_prefill: string;
		/** Fully-built wa.me link, or null when WHATSAPP_NUMBER is unset (never a broken link). */
		whatsapp_url: string | null;
		whish_note: string;
		/** The Whish payment link, or null when WHISH_LINK is unset. */
		whish_link: string | null;
	};
	meta: { first_name: string; overall_band: string; archetype: string; lead_status: string; recommended_program: string };
}

export type EventType = 'start' | 'advance' | 'contact_reached' | 'completed' | 'whatsapp_clicked';

export interface SubmitResponse {
	id: string;
	result_payload: ResultPayload;
}

/**
 * POST the assembled submission to the scoring/persistence endpoint.
 * Resolves with { id, result_payload } on 200; throws on any non-2xx or malformed body
 * (the caller turns that into a friendly retryable error — the student never sees a raw error).
 */
export async function submitDiagnostic(submission: unknown): Promise<SubmitResponse> {
	const res = await fetch('/api/diagnostic/submit', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(submission),
	});
	if (!res.ok) throw new Error(`submit_failed_${res.status}`);
	const data = (await res.json()) as Partial<SubmitResponse>;
	if (!data || !data.result_payload || !data.id) throw new Error('submit_no_payload');
	return data as SubmitResponse;
}

/**
 * Fire-and-forget analytics beacon (PRD §11 / US-7 / F2.2). Never throws, never blocks,
 * never breaks the result screen if it fails. `keepalive` lets it survive the navigation
 * that tapping the WhatsApp CTA triggers.
 */
export function postEvent(sessionId: string, type: EventType): void {
	try {
		void fetch('/api/event', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ session_id: sessionId, type }),
			keepalive: true,
		}).catch(() => {
			/* analytics failures are silent to the student */
		});
	} catch {
		/* never let a beacon throw into the render path */
	}
}
