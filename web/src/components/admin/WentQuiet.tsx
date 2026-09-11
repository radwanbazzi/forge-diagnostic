/**
 * "Finished but went quiet" (F-M3b, design spec §6.2).
 *
 * Everyone who completed the diagnostic and never tapped the WhatsApp button on their
 * result — `listLeads({ engaged: 0 })`. Unlike the anonymous funnel above it, these are
 * real people with real numbers, so this block is the actionable half of the screen: each
 * row opens the lead, where the founder's ready-to-send message and the WhatsApp button
 * already live (F-M3a).
 *
 * Presentational only — the parent owns the fetch, exactly as LeadsList does.
 *
 * The honest caveat is rendered, not buried: a tap is a proxy for starting a chat, not
 * proof of one. Someone can copy the number by hand, or message from another phone.
 * `followup_status = 'Replied'`, which the owner sets themselves, is the real signal.
 */
import { formatGap, relativeTime, shortProgram, type LeadSummary } from '../../lib/adminApi';

interface Props {
	leads: LeadSummary[];
	/** Total matching the filter server-side; the list itself is capped at one page. */
	total: number;
	loading: boolean;
	error: string | null;
	/** True when there are no leads AT ALL, which needs a different message from "none quiet". */
	noLeadsAtAll: boolean;
	onSelect: (lead: LeadSummary) => void;
}

export default function WentQuiet({ leads, total, loading, error, noLeadsAtAll, onSelect }: Props) {
	return (
		<section className="ai-block" aria-labelledby="ai-quiet-title">
			<header className="ai-block-head">
				<h2 className="ai-block-title" id="ai-quiet-title">
					Finished but went quiet
				</h2>
				{leads.length > 0 ? (
					<p className="ai-block-headline">
						{total} {total === 1 ? 'student' : 'students'} finished the diagnostic and never tapped WhatsApp.
					</p>
				) : null}
			</header>

			{error ? (
				<div className="al-state al-state-error" role="alert">
					<p className="al-state-title">Could not load this list</p>
					<p className="al-state-body">{error}</p>
				</div>
			) : loading && leads.length === 0 ? (
				<div className="al-state" aria-live="polite">
					<p className="al-state-body">Loading…</p>
				</div>
			) : leads.length === 0 ? (
				<div className="ai-empty">
					<p className="ai-empty-title">{noLeadsAtAll ? 'Nobody has finished the diagnostic yet' : 'Everyone who finished tapped through'}</p>
					<p className="ai-empty-body">
						{noLeadsAtAll
							? 'This becomes your warm list: students who answered all 22 questions, saw their result, and then did not tap the WhatsApp button. They gave you a real name and a real number and then went quiet — the highest-value people to chase, because they already know what their score gap is.'
							: 'Every student who finished also tapped the WhatsApp button on their result. Nothing to chase here — which is the outcome you want.'}
					</p>
					<p className="ai-empty-need">
						<strong>To fill this in:</strong>{' '}
						{noLeadsAtAll
							? 'one student completing the quiz through to the result screen without tapping the WhatsApp button.'
							: 'nothing — this stays empty as long as everyone taps through.'}
					</p>
				</div>
			) : (
				<>
					<ul className="aq-list">
						{leads.map((lead) => {
							const sent = lead.result_sent === 1;
							return (
								<li key={lead.id} className={`aq-item${sent ? ' is-sent' : ''}`}>
									<button type="button" className="aq-open" onClick={() => onSelect(lead)}>
										<span className="aq-name">{lead.first_name}</span>
										<span className={`al-pill al-pill-${lead.lead_status.toLowerCase()}`}>{lead.lead_status}</span>
										<span className="aq-meta mono">{lead.overall_band}</span>
										<span className="aq-meta mono">{formatGap(lead.gap)}</span>
										<span className="aq-meta aq-archetype">{lead.archetype}</span>
										<span className="aq-meta mono">{shortProgram(lead.recommended_program)}</span>
										<span className="aq-when">{relativeTime(lead.created_at)}</span>
										<span className={`al-tag ${sent ? 'al-tag-sent' : 'al-tag-todo'}`}>{sent ? 'result sent' : 'not sent yet'}</span>
									</button>
								</li>
							);
						})}
					</ul>

					{total > leads.length ? (
						<p className="al-more">
							Showing the newest {leads.length} of {total}.
						</p>
					) : null}
				</>
			)}

			<p className="aq-caveat">
				<strong>Worth knowing.</strong> “Tapped WhatsApp” is a proxy for starting a chat, not proof of one — a student could copy the number
				by hand or message you from a different phone. The reliable signal is the follow-up status you set yourself on a lead:{' '}
				<span className="mono">Replied</span>.
			</p>
		</section>
	);
}
