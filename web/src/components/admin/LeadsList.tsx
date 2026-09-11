/**
 * The leads queue (F-M3a, design spec §5.2).
 *
 * Presentational only: it renders rows and raises a selection. It never fetches — the
 * parent owns the query so the list, the tab badge and the detail always agree.
 *
 * Responsive by CSS, not by branching: ONE markup tree renders as a table at >=900px and
 * as one card per lead below that. Because the card layout switches the table elements to
 * `display: block`, which strips their implicit table semantics, every element carries an
 * explicit ARIA role so screen readers keep reading it as a table at both sizes.
 */
import type { LeadSummary } from '../../lib/adminApi';
import { formatGap, relativeTime, shortProgram } from '../../lib/adminApi';

/** Why the list came back empty — the three cases need three different messages (§5.4). */
export type EmptyKind = 'no-leads' | 'no-match' | 'all-caught-up';

interface Props {
	leads: LeadSummary[];
	loading: boolean;
	/** Null unless the list request itself failed. 401 is handled by the parent. */
	error: string | null;
	selectedId: string | null;
	onSelect: (lead: LeadSummary) => void;
	emptyKind: EmptyKind;
	/** Shown under the table so the owner knows the list is capped, not complete. */
	total: number;
}

function StatusPill({ status }: { status: LeadSummary['lead_status'] }) {
	return <span className={`al-pill al-pill-${status.toLowerCase()}`}>{status}</span>;
}

const EMPTY_COPY: Record<EmptyKind, { title: string; body: string }> = {
	'all-caught-up': {
		title: "You're all caught up",
		body: 'Every lead has had their result sent. New ones land here as students finish the diagnostic.',
	},
	'no-match': {
		title: 'Nothing matched that search',
		body: 'Search matches a first name or a phone number. Try fewer characters, or the last few digits of the number.',
	},
	'no-leads': {
		title: 'No leads yet',
		body: 'Every completed diagnostic shows up here automatically, newest first.',
	},
};

export default function LeadsList({ leads, loading, error, selectedId, onSelect, emptyKind, total }: Props) {
	if (error) {
		return (
			<div className="al-state al-state-error" role="alert">
				<p className="al-state-title">Could not load leads</p>
				<p className="al-state-body">{error}</p>
			</div>
		);
	}

	// Keep the previous rows visible while a debounced search refreshes underneath, so the
	// list does not flash empty on every keystroke.
	if (loading && leads.length === 0) {
		return (
			<div className="al-state" aria-live="polite">
				<p className="al-state-body">Loading leads…</p>
			</div>
		);
	}

	if (leads.length === 0) {
		const copy = EMPTY_COPY[emptyKind];
		return (
			<div className="al-state">
				<p className="al-state-title">{copy.title}</p>
				<p className="al-state-body">{copy.body}</p>
			</div>
		);
	}

	return (
		<div className={`al-list${loading ? ' is-refreshing' : ''}`}>
			<table className="al-table" role="table">
				<thead role="rowgroup">
					<tr role="row">
						<th role="columnheader" scope="col">
							Name
						</th>
						<th role="columnheader" scope="col">
							When
						</th>
						<th role="columnheader" scope="col">
							Status
						</th>
						<th role="columnheader" scope="col">
							Band
						</th>
						<th role="columnheader" scope="col">
							Gap
						</th>
						<th role="columnheader" scope="col">
							Profile
						</th>
						<th role="columnheader" scope="col">
							Program
						</th>
						<th role="columnheader" scope="col">
							Signals
						</th>
					</tr>
				</thead>
				<tbody role="rowgroup">
					{leads.map((lead) => {
						const sent = lead.result_sent === 1;
						const tapped = lead.whatsapp_clicked === 1;
						return (
							<tr
								key={lead.id}
								role="row"
								className={`al-row${sent ? ' is-sent' : ''}${selectedId === lead.id ? ' is-selected' : ''}`}
								onClick={() => onSelect(lead)}
							>
								<td role="cell" data-label="Name">
									{/* A real button carries the keyboard affordance and the full accessible
									    name; the whole row stays clickable for the mouse. */}
									<button
										type="button"
										className="al-name"
										onClick={(e) => {
											e.stopPropagation();
											onSelect(lead);
										}}
									>
										{sent ? (
											<span className="al-tick" aria-hidden="true">
												✓
											</span>
										) : null}
										{lead.first_name}
										<span className="al-sr">
											{` — ${lead.lead_status}, ${lead.archetype}, ${sent ? 'result sent' : 'not sent yet'}${
												tapped ? ', tapped you on WhatsApp' : ''
											}`}
										</span>
									</button>
								</td>
								<td role="cell" data-label="When" className="al-when">
									{relativeTime(lead.created_at)}
								</td>
								<td role="cell" data-label="Status">
									<StatusPill status={lead.lead_status} />
								</td>
								<td role="cell" data-label="Band" className="mono al-band">
									{lead.overall_band}
								</td>
								<td role="cell" data-label="Gap" className="mono">
									{formatGap(lead.gap)}
								</td>
								<td role="cell" data-label="Profile" className="al-archetype">
									{lead.archetype}
								</td>
								<td role="cell" data-label="Program" className="mono">
									{shortProgram(lead.recommended_program)}
								</td>
								<td role="cell" data-label="Signals" className="al-signals">
									{tapped ? (
										<span className="al-tag al-tag-tapped" title="This lead tapped the WhatsApp button on their result">
											tapped you
										</span>
									) : null}
									{sent ? <span className="al-tag al-tag-sent">sent</span> : <span className="al-tag al-tag-todo">to send</span>}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>

			{total > leads.length ? (
				<p className="al-more">
					Showing the newest {leads.length} of {total}. Narrow it with the search box or a filter.
				</p>
			) : null}
		</div>
	);
}
