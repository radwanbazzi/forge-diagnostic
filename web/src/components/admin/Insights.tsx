/**
 * The insights screen (F-M3b, design spec §6) — the owner's weekly study session.
 *
 * Three blocks in the owner's stated priority order:
 *   1. Where students quit          — the drop-off funnel, with the questions / contact-gate
 *                                     boundary drawn explicitly (Funnel.tsx).
 *   2. Finished but went quiet      — completed and never tapped WhatsApp (WentQuiet.tsx).
 *   3. Who the quiz is attracting   — status / profile / programme mix (AudienceMix.tsx).
 *
 * This component owns the two reads and every load / error / empty state; the three blocks
 * stay presentational, which keeps each of them small and testable on its own.
 *
 * TWO REQUESTS, NOT MORE. `GET /api/admin/analytics` (six aggregates server-side) and one
 * `GET /api/admin/leads?engaged=0`. Both are issued together so their round trips overlap,
 * and both are aborted if the screen is left before they land.
 *
 * Empty states carry the weight here (spec §6.4): this ships before any traffic exists, so
 * on day one all three blocks are empty. Each one names what will appear and what has to
 * happen to fill it, because a blank chart reads as a broken feature.
 */
import { useCallback, useEffect, useState } from 'react';
import FunnelBlock from './Funnel';
import WentQuiet from './WentQuiet';
import AudienceMix from './AudienceMix';
import { AdminApiError, getAnalytics, listLeads, type Analytics, type LeadPatchResponse, type LeadSummary } from '../../lib/adminApi';
import { buildFunnel } from '../../lib/funnel';

/** Enough to be actionable in one sitting without paging (the server's max is 200). */
const QUIET_PAGE_SIZE = 50;

interface Props {
	/** Opens a lead in the shared detail pane, so the went-quiet list is actionable. */
	onSelectLead: (lead: LeadSummary) => void;
	/** Raised on a 401 so the whole dashboard shows the Access-expired screen, not this block. */
	onUnauthorized: () => void;
	/** Bumped by the dashboard's Refresh button. */
	reloadKey: number;
	/**
	 * The most recent lead save. Applied to the went-quiet rows in place rather than
	 * refetching, so a row the founder just marked sent updates under their eyes instead
	 * of the whole list reordering while they are still reading it.
	 */
	lastChanged: LeadPatchResponse | null;
}

interface QuietState {
	leads: LeadSummary[];
	total: number;
	error: string | null;
	loading: boolean;
}

export default function Insights({ onSelectLead, onUnauthorized, reloadKey, lastChanged }: Props) {
	const [analytics, setAnalytics] = useState<Analytics | null>(null);
	const [analyticsError, setAnalyticsError] = useState<string | null>(null);
	const [quiet, setQuiet] = useState<QuietState>({ leads: [], total: 0, error: null, loading: true });

	const describe = useCallback((err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.'), []);

	useEffect(() => {
		const ac = new AbortController();
		setAnalyticsError(null);
		setQuiet((q) => ({ ...q, loading: true, error: null }));

		// Independent reads, issued together: the two round trips overlap instead of adding up.
		getAnalytics(ac.signal)
			.then((a) => {
				if (ac.signal.aborted) return;
				setAnalytics(a);
			})
			.catch((err: unknown) => {
				if (ac.signal.aborted) return;
				if (err instanceof AdminApiError && err.status === 401) return onUnauthorized();
				setAnalyticsError(describe(err));
			});

		listLeads({ engaged: 0, limit: QUIET_PAGE_SIZE }, ac.signal)
			.then((res) => {
				if (ac.signal.aborted) return;
				setQuiet({ leads: res.leads, total: res.total, error: null, loading: false });
			})
			.catch((err: unknown) => {
				if (ac.signal.aborted) return;
				if (err instanceof AdminApiError && err.status === 401) return onUnauthorized();
				setQuiet({ leads: [], total: 0, error: describe(err), loading: false });
			});

		return () => ac.abort();
	}, [reloadKey, onUnauthorized, describe]);

	// A save landed in the detail pane. Patch that row where it sits — the filter is
	// `engaged=0`, and none of the four writable fields can change engagement, so the row
	// belongs in this list either way.
	useEffect(() => {
		if (!lastChanged) return;
		setQuiet((q) => ({
			...q,
			leads: q.leads.map((l) =>
				l.id === lastChanged.id
					? { ...l, result_sent: lastChanged.result_sent, followup_status: lastChanged.followup_status, outcome: lastChanged.outcome }
					: l,
			),
		}));
	}, [lastChanged]);

	// The funnel is the top block, so its loading and error states stand in for the screen's.
	if (analyticsError) {
		return (
			<div className="ai-screen">
				<div className="al-state al-state-error" role="alert">
					<p className="al-state-title">Could not load your insights</p>
					<p className="al-state-body">{analyticsError}</p>
				</div>
			</div>
		);
	}

	if (!analytics) {
		return (
			<div className="ai-screen">
				<div className="al-state" aria-live="polite">
					<p className="al-state-body">Loading insights…</p>
				</div>
			</div>
		);
	}

	const funnel = buildFunnel(analytics);

	return (
		<div className="ai-screen">
			<FunnelBlock funnel={funnel} />
			<WentQuiet
				leads={quiet.leads}
				total={quiet.total}
				loading={quiet.loading}
				error={quiet.error}
				noLeadsAtAll={analytics.totals.leads === 0}
				onSelect={onSelectLead}
			/>
			<AudienceMix analytics={analytics} />
		</div>
	);
}
