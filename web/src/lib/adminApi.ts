/**
 * Admin API client for the /admin dashboard (F-M3a).
 *
 * Every call hits the same-origin Worker at /api/admin/*, which is gated by Cloudflare
 * Access in production and re-verified inside the Worker (src/lib/access.ts). This module
 * adds no authority of its own: in production the browser simply carries the Access cookie.
 *
 * ⚠️ Boundary rule (CLAUDE.md): nothing here may import from the server tree except
 * src/lib/questions.ts, which is browser-safe. The row/response types below are therefore
 * a hand-kept MIRROR of src/db/schema.ts + src/routes/admin.ts, exactly as web/src/lib/api.ts
 * mirrors the result payload. No scoring, no answer key, ever.
 */
import type { ResultPayload } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Local-dev sign-in (NEVER usable in production — see the three gates below)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The dashboard's dev sign-in exists only because Cloudflare Access is not wired up yet
 * (F-M4c). It is safe because it is gated THREE times, two of them server-side:
 *
 *  1. CLIENT — this function. The panel is only rendered, and the headers are only ever
 *     attached, when the page is served from a loopback host. On a real domain the dev
 *     code path is unreachable, so a deployed bundle cannot send these headers at all.
 *  2. SERVER — devBypassAllowed() requires DEV_ADMIN_SECRET, which lives only in
 *     .dev.vars (gitignored) and is never set with `wrangler secret put`. No secret → 401.
 *  3. SERVER — that same check force-disables the bypass whenever ACCESS_AUD is set,
 *     i.e. whenever the Worker is configured for production Access. So even if the
 *     secret somehow leaked into production, the bypass would still be off.
 *
 * Exact-match only: "evil-localhost.com" and "localhost.attacker.io" both return false.
 */
export function isLocalDevHost(): boolean {
	if (typeof location === 'undefined') return false;
	const h = location.hostname.toLowerCase();
	return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

export interface DevAuth {
	secret: string;
	email: string;
}

/** sessionStorage, not localStorage: the dev secret dies with the tab. */
const DEV_AUTH_KEY = 'forge.admin.devAuth';

export function getDevAuth(): DevAuth | null {
	if (!isLocalDevHost()) return null;
	try {
		const raw = sessionStorage.getItem(DEV_AUTH_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<DevAuth>;
		if (typeof parsed?.secret !== 'string' || typeof parsed?.email !== 'string') return null;
		return { secret: parsed.secret, email: parsed.email };
	} catch {
		return null; // storage disabled or corrupt → simply not signed in
	}
}

export function setDevAuth(auth: DevAuth): void {
	if (!isLocalDevHost()) return;
	try {
		sessionStorage.setItem(DEV_AUTH_KEY, JSON.stringify(auth));
	} catch {
		/* private mode / storage disabled — headers still work for this page view */
	}
}

export function clearDevAuth(): void {
	try {
		sessionStorage.removeItem(DEV_AUTH_KEY);
	} catch {
		/* nothing to clean up */
	}
}

/**
 * Headers for an admin request. In production this is ALWAYS an empty object — the Access
 * cookie the browser already holds is what authenticates, and isLocalDevHost() is false,
 * so the dev headers are unreachable.
 */
function authHeaders(): Record<string, string> {
	const dev = getDevAuth();
	if (!dev) return {};
	return { 'X-Dev-Access-Secret': dev.secret, 'X-Dev-Access-Email': dev.email };
}

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrors of the Worker's responses)
// ─────────────────────────────────────────────────────────────────────────────

export type LeadStatus = 'HOT' | 'WARM' | 'COLD';
export type Program = '$80 SAT Essentials' | '$130 SAT Accelerator';
export type FollowupStatus = 'None' | 'Msg1 sent' | 'Msg2 sent' | 'Replied' | 'Not interested';
export type Outcome = '-' | 'Enrolled $80' | 'Enrolled $130' | 'Lost';

export const FOLLOWUP_STATUSES: readonly FollowupStatus[] = ['None', 'Msg1 sent', 'Msg2 sent', 'Replied', 'Not interested'];
export const OUTCOMES: readonly Outcome[] = ['-', 'Enrolled $80', 'Enrolled $130', 'Lost'];

/** One row of GET /api/admin/leads (the lean list projection). */
export interface LeadSummary {
	id: string;
	created_at: number;
	first_name: string;
	whatsapp: string;
	school: string | null;
	archetype: string;
	overall_band: string;
	gap: number | null;
	lead_score: number;
	lead_status: LeadStatus;
	recommended_program: Program;
	result_sent: number;
	followup_status: FollowupStatus;
	outcome: Outcome;
	/** 1 when a whatsapp_clicked event exists for this lead's session ("tapped you"). */
	whatsapp_clicked: number;
}

export interface LeadsResponse {
	leads: LeadSummary[];
	total: number;
}

/** Per-question measured timing for the 8 scored skills questions (F-M-Timer). */
export interface SkillsTiming {
	sec: number;
	timed_out: boolean;
}

/**
 * GET /api/admin/leads/:id — the full row, with result_payload already parsed and the
 * founder's ready-to-send message assembled server-side (PRD §10).
 */
export interface LeadDetailRow extends LeadSummary {
	session_id: string;
	source: string | null;
	completion_time_sec: number | null;
	skills_time_total_sec: number | null;
	skills_timed_out_count: number | null;
	skills_timings: string | null;

	// answers
	target_score: string;
	grade: string;
	test_date: string;
	sat_history: string;
	q5: string;
	q6: string;
	q7: string;
	q8: string;
	q9: string;
	q10: string;
	q11: string;
	q12: string;
	hours_per_week: string;
	timing: string;
	review_mistakes: string;
	prep_status: string;
	worried_about: string;
	respondent_type: 'student' | 'parent';
	consent: number;

	// computed (READ-ONLY — never editable from this UI)
	math_raw: number;
	rw_raw: number;
	confidence: string;
	target_num: number;
	current_mid: number;
	timeline_verdict: string;

	notes: string | null;
	result_payload: ResultPayload | null;
	whatsapp_message: string;
}

/**
 * What PATCH /api/admin/leads/:id actually returns: the updated row, but WITHOUT
 * `whatsapp_message` — only the GET handler assembles that. Typed as its own shape so a
 * patch response can never be mistaken for a full lead: assigning one straight into state
 * would blank the founder's message and produce a `wa.me/…?text=undefined` link.
 *
 * The message is invariant under a PATCH anyway (it is built from the name, band,
 * archetype and programme, none of which are writable), so callers merge the response
 * over the lead they already hold rather than replacing it.
 */
export type LeadPatchResponse = Omit<LeadDetailRow, 'whatsapp_message'>;

/** The ONLY fields this UI may write. Mirrors the server's PATCH whitelist exactly. */
export interface LeadPatch {
	result_sent?: boolean;
	followup_status?: FollowupStatus;
	outcome?: Outcome;
	notes?: string | null;
}

export interface LeadQuery {
	q?: string;
	status?: LeadStatus;
	program?: string;
	result_sent?: 0 | 1;
	engaged?: 0 | 1;
	from?: string;
	to?: string;
	limit?: number;
	offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

/** An admin API failure that still knows its HTTP status, so 401 can be handled specially. */
export class AdminApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'AdminApiError';
		this.status = status;
	}
}

/** status 0 means the request never reached the Worker (offline, dev server down). */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			...init,
			headers: { ...(init?.headers as Record<string, string> | undefined), ...authHeaders() },
		});
	} catch (err) {
		// An aborted request is a normal part of debounced searching, not a failure to show.
		if (err instanceof DOMException && err.name === 'AbortError') throw err;
		throw new AdminApiError(0, 'Could not reach the server. Is the dev server still running?');
	}

	if (!res.ok) {
		if (res.status === 401) throw new AdminApiError(401, 'unauthorized');
		let detail = '';
		try {
			const body = (await res.json()) as { error?: string };
			detail = body?.error ? ` (${body.error})` : '';
		} catch {
			/* non-JSON error body — the status alone is enough */
		}
		throw new AdminApiError(res.status, `Request failed: ${res.status}${detail}`);
	}

	return (await res.json()) as T;
}

/** Build the query string, dropping empty values so we never send a bare "?q=". */
function toSearchParams(query: LeadQuery): string {
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null || v === '') continue;
		p.set(k, String(v));
	}
	const s = p.toString();
	return s ? `?${s}` : '';
}

export function listLeads(query: LeadQuery = {}, signal?: AbortSignal): Promise<LeadsResponse> {
	return request<LeadsResponse>(`/api/admin/leads${toSearchParams(query)}`, { signal });
}

export function getLead(id: string, signal?: AbortSignal): Promise<LeadDetailRow> {
	return request<LeadDetailRow>(`/api/admin/leads/${encodeURIComponent(id)}`, { signal });
}

/**
 * PATCH a lead. Only the four manual fields are ever sent — computed fields (score, band,
 * archetype) and the answers are not part of LeadPatch, so this UI cannot express a write
 * to them even by mistake; the server's whitelist rejects them independently.
 */
export function patchLead(id: string, patch: LeadPatch): Promise<LeadPatchResponse> {
	const body: LeadPatch = {};
	if (patch.result_sent !== undefined) body.result_sent = patch.result_sent;
	if (patch.followup_status !== undefined) body.followup_status = patch.followup_status;
	if (patch.outcome !== undefined) body.outcome = patch.outcome;
	if (patch.notes !== undefined) body.notes = patch.notes;

	return request<LeadPatchResponse>(`/api/admin/leads/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Small presentation helpers (shared by the list and the detail)
// ─────────────────────────────────────────────────────────────────────────────

/** Digits only — what wa.me needs. Students type "+961 70 12 34 56", "03-123-456", … */
export function waDigits(raw: string | null | undefined): string {
	return (raw ?? '').replace(/\D/g, '');
}

/**
 * A wa.me deep link with the founder's message pre-filled, or null when the stored number
 * has no digits at all. Same rule as the student result screen (F2.1): never render a
 * broken link — disable the control instead.
 */
export function waLink(phone: string | null | undefined, message: string): string | null {
	const digits = waDigits(phone);
	if (!digits) return null;
	return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * wa.me needs a full international number. A stored "03 123 456" is a perfectly valid
 * Lebanese local number but dials nothing on WhatsApp, so the UI warns rather than
 * silently opening a dead chat. We never guess a country code — that could message a
 * stranger.
 */
export function looksLocalOnly(phone: string | null | undefined): boolean {
	const digits = waDigits(phone);
	if (!digits) return false; // no digits at all is a different case (the link is disabled)
	return digits.startsWith('0') || digits.length < 9;
}

/** "just now" · "14m ago" · "3h ago" · "2d ago" · then an absolute date. */
export function relativeTime(ms: number, now: number = Date.now()): string {
	const diff = Math.max(0, now - ms);
	const min = Math.floor(diff / 60000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 14) return `${day}d ago`;
	return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The gap column: null means the student picked "Not sure yet" for a target. */
export function formatGap(gap: number | null): string {
	if (gap === null || gap === undefined) return '—';
	return gap > 0 ? `+${gap}` : String(gap);
}

/** "$130 SAT Accelerator" → "$130" for the tight list columns. */
export function shortProgram(program: string): string {
	const m = program.match(/\$\d+/);
	return m ? m[0] : program;
}
