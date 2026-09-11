/**
 * One lead, opened from the queue (F-M3a, design spec §5.3).
 *
 * Order on screen is deliberate and owner-approved: identity, then THE ACTION BLOCK
 * (the ready-to-send WhatsApp message, the button that opens it, and "Mark sent"), then
 * the manual tracking fields, and only then the full result and the 22 answers — both
 * collapsed, so the every-2-days sweep stays scannable and the weekly deep read can expand.
 *
 * Writes go through patchLead(), whose LeadPatch type contains ONLY the four manual
 * fields. Score, band, archetype and every answer are rendered as plain text with no
 * control attached — they cannot be edited from this UI, and the server's whitelist
 * rejects them independently.
 *
 * Auto-save: the selects PATCH on change, notes debounce ~600ms and also flush when the
 * lead is closed or switched, so nothing typed is ever lost on the way out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { QUESTIONS } from '../../../../src/lib/questions';
import {
	AdminApiError,
	FOLLOWUP_STATUSES,
	OUTCOMES,
	getLead,
	looksLocalOnly,
	patchLead,
	relativeTime,
	waDigits,
	waLink,
	type FollowupStatus,
	type LeadDetailRow,
	type LeadPatchResponse,
	type LeadPatch,
	type Outcome,
	type SkillsTiming,
} from '../../lib/adminApi';

const NOTES_DEBOUNCE_MS = 600;

interface Props {
	leadId: string;
	onClose: () => void;
	/** Raised after every successful save so the queue row and the tab badge stay in step. */
	onChanged: (lead: LeadPatchResponse) => void;
	onNext: () => void;
	hasNext: boolean;
	/** A 401 anywhere means the Access session died — the whole screen handles it, not this one. */
	onUnauthorized: () => void;
}

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string };

/** The answer this lead gave to one of the 22 questions, as displayable text. */
function answerFor(lead: LeadDetailRow, field: string): string {
	if (field === 'consent') return lead.consent === 1 ? 'Agreed' : 'Not agreed';
	if (field === 'respondent_type') return lead.respondent_type === 'parent' ? 'Parent' : 'Student';
	const v = (lead as unknown as Record<string, unknown>)[field];
	if (v === null || v === undefined || v === '') return '—';
	return String(v);
}

/** Measured per-question timing for the 8 scored skills questions (F-M-Timer), if present. */
function parseTimings(raw: string | null): Record<string, SkillsTiming> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, SkillsTiming>;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export default function LeadDetail({ leadId, onClose, onChanged, onNext, hasNext, onUnauthorized }: Props) {
	const [lead, setLead] = useState<LeadDetailRow | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [save, setSave] = useState<SaveState>({ status: 'idle' });
	const [copied, setCopied] = useState(false);

	// Local mirrors of the three editable fields so typing stays instant and a failed save
	// never throws away what the owner wrote.
	const [followup, setFollowup] = useState<FollowupStatus>('None');
	const [outcome, setOutcome] = useState<Outcome>('-');
	const [notes, setNotes] = useState('');

	const notesTimer = useRef<number | null>(null);
	const pendingNotes = useRef<string | null>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// Load (and reload when the sweep moves to the next lead).
	useEffect(() => {
		const ac = new AbortController();
		setLead(null);
		setLoadError(null);
		setSave({ status: 'idle' });
		setCopied(false);

		getLead(leadId, ac.signal)
			.then((row) => {
				if (ac.signal.aborted) return;
				setLead(row);
				setFollowup(row.followup_status);
				setOutcome(row.outcome);
				setNotes(row.notes ?? '');
			})
			.catch((err: unknown) => {
				if (ac.signal.aborted) return;
				if (err instanceof AdminApiError && err.status === 401) return onUnauthorized();
				setLoadError(err instanceof Error ? err.message : 'Could not load this lead.');
			});

		return () => ac.abort();
	}, [leadId, onUnauthorized]);

	const persist = useCallback(
		async (patch: LeadPatch) => {
			setSave({ status: 'saving' });
			try {
				const updated = await patchLead(leadId, patch);
				onChanged(updated);
				if (!mounted.current) return;
				// MERGE, never replace: the PATCH response carries every column but not
				// `whatsapp_message` (only the GET handler assembles it). Replacing would blank
				// the founder's message and turn the CTA into wa.me/…?text=undefined. The message
				// cannot change under a PATCH anyway — nothing it is built from is writable.
				setLead((prev) => (prev ? { ...prev, ...updated } : prev));
				setSave({ status: 'saved' });
			} catch (err) {
				if (err instanceof AdminApiError && err.status === 401) return onUnauthorized();
				if (!mounted.current) return;
				// The typed value stays on screen; only the indicator reports the failure.
				setSave({ status: 'error', message: err instanceof Error ? err.message : 'Save failed.' });
			}
		},
		[leadId, onChanged, onUnauthorized],
	);

	/** Send any notes still sitting in the debounce window (on close, next lead, or unmount). */
	const flushNotes = useCallback(() => {
		if (notesTimer.current !== null) {
			window.clearTimeout(notesTimer.current);
			notesTimer.current = null;
		}
		const v = pendingNotes.current;
		if (v === null) return;
		pendingNotes.current = null;
		void persist({ notes: v });
	}, [persist]);

	// Keep a stable handle on the latest flush so the unmount cleanup below never fires a
	// stale closure (which would save an older draft, or nothing at all).
	const flushRef = useRef(flushNotes);
	useEffect(() => {
		flushRef.current = flushNotes;
	}, [flushNotes]);
	useEffect(() => () => flushRef.current(), [leadId]);

	function onNotesChange(value: string) {
		setNotes(value);
		pendingNotes.current = value;
		if (notesTimer.current !== null) window.clearTimeout(notesTimer.current);
		notesTimer.current = window.setTimeout(() => flushRef.current(), NOTES_DEBOUNCE_MS);
	}

	async function copyMessage(message: string) {
		try {
			await navigator.clipboard.writeText(message);
			setCopied(true);
			window.setTimeout(() => mounted.current && setCopied(false), 2000);
		} catch {
			// Clipboard blocked (insecure context / permission). The message is already on
			// screen and selectable, so say that rather than failing silently.
			setSave({ status: 'error', message: 'Could not copy automatically — select the message above and copy it.' });
		}
	}

	if (loadError) {
		return (
			<aside className="ad-detail" aria-label="Lead detail">
				<div className="al-state al-state-error" role="alert">
					<p className="al-state-title">Could not load this lead</p>
					<p className="al-state-body">{loadError}</p>
					<button type="button" className="ad-btn" onClick={onClose}>
						Back to the list
					</button>
				</div>
			</aside>
		);
	}

	if (!lead) {
		return (
			<aside className="ad-detail" aria-label="Lead detail" aria-busy="true">
				<div className="al-state">
					<p className="al-state-body">Loading lead…</p>
				</div>
			</aside>
		);
	}

	const sent = lead.result_sent === 1;
	const link = waLink(lead.whatsapp, lead.whatsapp_message);
	const digits = waDigits(lead.whatsapp);
	const localOnly = looksLocalOnly(lead.whatsapp);
	const timings = parseTimings(lead.skills_timings);
	const payload = lead.result_payload;

	return (
		<aside className="ad-detail" aria-label={`Lead detail for ${lead.first_name}`}>
			<div className="ad-detail-bar">
				<button type="button" className="ad-btn ad-btn-quiet" onClick={onClose}>
					← Back
				</button>
				<span className={`ad-save ad-save-${save.status}`} role="status" aria-live="polite">
					{save.status === 'saving' ? 'Saving…' : save.status === 'saved' ? 'Saved' : save.status === 'error' ? save.message : ''}
				</span>
			</div>

			{/* ── 1. Identity ───────────────────────────────────────────────────────── */}
			<header className="ad-identity">
				<h2 className="ad-name">{lead.first_name}</h2>
				<div className="ad-identity-tags">
					<span className={`al-pill al-pill-${lead.lead_status.toLowerCase()}`}>{lead.lead_status}</span>
					<span className="ad-meta mono">score {lead.lead_score}</span>
					{lead.whatsapp_clicked === 1 ? <span className="al-tag al-tag-tapped">tapped you</span> : null}
					{sent ? <span className="al-tag al-tag-sent">result sent</span> : <span className="al-tag al-tag-todo">to send</span>}
				</div>
				<dl className="ad-facts">
					<div>
						<dt>Phone</dt>
						<dd className="mono">{lead.whatsapp}</dd>
					</div>
					<div>
						<dt>Completing as</dt>
						<dd>{lead.respondent_type === 'parent' ? 'Parent' : 'Student'}</dd>
					</div>
					<div>
						<dt>Grade</dt>
						<dd>{lead.grade}</dd>
					</div>
					<div>
						<dt>School</dt>
						<dd>{lead.school || '—'}</dd>
					</div>
					<div>
						<dt>Taken</dt>
						<dd>{relativeTime(lead.created_at)}</dd>
					</div>
				</dl>
			</header>

			{/* ── 2. The action block — message, WhatsApp, mark sent (§5.3) ──────────── */}
			<section className="ad-action" aria-labelledby="ad-action-h">
				<h3 id="ad-action-h" className="ad-h3">
					Ready to send
				</h3>
				<pre className="ad-message">{lead.whatsapp_message}</pre>

				<div className="ad-actions">
					{link ? (
						<a className="ad-btn ad-btn-primary" href={link} target="_blank" rel="noopener noreferrer">
							<span aria-hidden="true">💬</span> Open WhatsApp to <span className="mono">+{digits}</span>
						</a>
					) : (
						// Same rule as the student result screen: never render a broken wa.me link.
						<button type="button" className="ad-btn ad-btn-primary is-disabled" disabled aria-disabled="true">
							No usable phone number
						</button>
					)}

					<button type="button" className="ad-btn" onClick={() => void copyMessage(lead.whatsapp_message)}>
						{copied ? 'Copied ✓' : 'Copy message'}
					</button>

					{sent ? (
						<span className="ad-sent-state">
							<span className="al-tag al-tag-sent">Sent ✓</span>
							<button type="button" className="ad-link" onClick={() => void persist({ result_sent: false })}>
								undo
							</button>
						</span>
					) : (
						<button type="button" className="ad-btn ad-btn-mark" onClick={() => void persist({ result_sent: true })}>
							Mark sent
						</button>
					)}

					{hasNext ? (
						<button
							type="button"
							className="ad-btn ad-btn-quiet ad-btn-next"
							onClick={() => {
								flushNotes();
								onNext();
							}}
						>
							Next lead →
						</button>
					) : null}
				</div>

				{!link ? (
					<p className="ad-warn">This lead typed no digits in the WhatsApp field, so there is nothing to open.</p>
				) : localOnly ? (
					<p className="ad-warn">
						Heads up: <span className="mono">{lead.whatsapp}</span> looks like a local number. WhatsApp needs the full
						international form (for Lebanon, <span className="mono">961…</span> without the leading 0). The button will still open —
						check the number it lands on before sending.
					</p>
				) : null}
			</section>

			{/* ── 3. Manual tracking — auto-saved, no save button ────────────────────── */}
			<section className="ad-manual" aria-labelledby="ad-manual-h">
				<h3 id="ad-manual-h" className="ad-h3">
					Your tracking
				</h3>
				<p className="ad-hint">Saves by itself as you change it.</p>

				<div className="ad-field">
					<label htmlFor="ad-followup">Follow-up</label>
					<select
						id="ad-followup"
						value={followup}
						onChange={(e) => {
							const v = e.target.value as FollowupStatus;
							setFollowup(v);
							void persist({ followup_status: v });
						}}
					>
						{FOLLOWUP_STATUSES.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</div>

				<div className="ad-field">
					<label htmlFor="ad-outcome">Outcome</label>
					<select
						id="ad-outcome"
						value={outcome}
						onChange={(e) => {
							const v = e.target.value as Outcome;
							setOutcome(v);
							void persist({ outcome: v });
						}}
					>
						{OUTCOMES.map((o) => (
							<option key={o} value={o}>
								{o === '-' ? '— none yet —' : o}
							</option>
						))}
					</select>
				</div>

				<div className="ad-field ad-field-notes">
					<label htmlFor="ad-notes">Notes</label>
					<textarea
						id="ad-notes"
						rows={4}
						maxLength={5000}
						placeholder="Anything worth remembering about this student…"
						value={notes}
						onChange={(e) => onNotesChange(e.target.value)}
						onBlur={() => flushNotes()}
					/>
				</div>
			</section>

			{/* ── 4. The full result and the 22 answers — collapsed by default ───────── */}
			<details className="ad-fold">
				<summary>Full result</summary>
				<div className="ad-fold-body">
					<dl className="ad-facts ad-facts-computed">
						<div>
							<dt>Estimated band</dt>
							<dd className="mono">{lead.overall_band}</dd>
						</div>
						<div>
							<dt>Confidence</dt>
							<dd>{lead.confidence}</dd>
						</div>
						<div>
							<dt>Profile</dt>
							<dd>{lead.archetype}</dd>
						</div>
						<div>
							<dt>Math / R&amp;W raw</dt>
							<dd className="mono">
								{lead.math_raw} / {lead.rw_raw}
							</dd>
						</div>
						<div>
							<dt>Target</dt>
							<dd className="mono">{lead.target_num}</dd>
						</div>
						<div>
							<dt>Gap</dt>
							<dd className="mono">{lead.gap === null ? '—' : lead.gap}</dd>
						</div>
						<div>
							<dt>Timeline</dt>
							<dd>{lead.timeline_verdict}</dd>
						</div>
						<div>
							<dt>Recommended</dt>
							<dd>{lead.recommended_program}</dd>
						</div>
					</dl>
					<p className="ad-hint">
						These are computed at submit time and are not editable — they are the snapshot the student actually saw.
					</p>

					{payload ? (
						<div className="ad-payload">
							<p>
								<strong>{payload.profile?.statement}</strong>
							</p>
							<p>{payload.profile?.meaning}</p>
							<p>{payload.reframe?.text}</p>
							<p>{payload.section_read}</p>
							{payload.top_fixes?.length ? (
								<>
									<p className="ad-payload-h">Top fixes</p>
									<ol>
										{payload.top_fixes.map((fix, i) => (
											<li key={i}>{fix}</li>
										))}
									</ol>
								</>
							) : null}
							<p>
								<strong>{payload.timeline?.verdict}</strong> — {payload.timeline?.line}
							</p>
							<p>{payload.recommendation?.text}</p>
						</div>
					) : (
						<p className="ad-hint">The stored result text could not be read for this lead, but every computed field above is intact.</p>
					)}
				</div>
			</details>

			<details className="ad-fold">
				<summary>All 22 answers</summary>
				<div className="ad-fold-body">
					{lead.completion_time_sec !== null || lead.skills_time_total_sec !== null ? (
						<p className="ad-hint">
							{lead.completion_time_sec !== null ? `Whole diagnostic: ${lead.completion_time_sec}s. ` : ''}
							{lead.skills_time_total_sec !== null ? `Skills section: ${lead.skills_time_total_sec}s` : ''}
							{lead.skills_timed_out_count ? `, ran out of time on ${lead.skills_timed_out_count} of 8.` : '.'}
						</p>
					) : null}
					<ol className="ad-answers">
						{QUESTIONS.map((q) => {
							const t = timings[q.field];
							return (
								<li key={q.n} className="ad-answer">
									<p className="ad-answer-q">
										<span className="mono ad-answer-n">Q{q.n}</span> {q.prompt}
									</p>
									<p className="ad-answer-a">
										{answerFor(lead, q.field)}
										{t ? (
											<span className={`ad-answer-time mono${t.timed_out ? ' is-timeout' : ''}`}>
												{t.timed_out ? `${t.sec}s — ran out of time` : `${t.sec}s`}
											</span>
										) : null}
									</p>
								</li>
							);
						})}
					</ol>
				</div>
			</details>
		</aside>
	);
}
