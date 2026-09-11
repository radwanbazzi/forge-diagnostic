/**
 * The Forge admin dashboard — root island (F-M3a, design spec §5).
 *
 * Owns navigation state (tab, search, selection) and the list query; the children stay
 * presentational (LeadsList) or own exactly one lead (LeadDetail). Built around the two
 * jobs the owner actually does:
 *
 *   Job 1 — "someone just messaged me, who are they?" The search box is pinned to the top
 *           of every view and matches a first name OR a phone number, so it works from a
 *           phone while the student is still waiting in WhatsApp.
 *   Job 2 — the every-2-days sweep. "To send" is the default tab, carries a count badge,
 *           and already-sent leads stay visible but greyed with a tick, so nobody is
 *           ever messaged twice.
 *
 * Auth: in production Cloudflare Access gates this page and the API. Access is not wired
 * up yet (F-M4c), so on localhost ONLY there is a clearly-labelled dev sign-in — see
 * isLocalDevHost() in ../lib/adminApi for why it cannot work anywhere else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LeadsList, { type EmptyKind } from './admin/LeadsList';
import LeadDetail from './admin/LeadDetail';
import Insights from './admin/Insights';
import {
	AdminApiError,
	clearDevAuth,
	getDevAuth,
	isLocalDevHost,
	listLeads,
	setDevAuth,
	type LeadPatchResponse,
	type LeadQuery,
	type LeadSummary,
} from '../lib/adminApi';
import './admin.css';

type Tab = 'to-send' | 'all' | 'insights';

const SEARCH_DEBOUNCE_MS = 250;
/** One page deep enough that the sweep almost never needs to page (server max is 200). */
const PAGE_SIZE = 100;

/** Value that only updates once the user has stopped typing for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const id = window.setTimeout(() => setDebounced(value), delay);
		return () => window.clearTimeout(id);
	}, [value, delay]);
	return debounced;
}

export default function AdminDashboard() {
	const [tab, setTab] = useState<Tab>('to-send');
	const [search, setSearch] = useState('');
	const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

	const [leads, setLeads] = useState<LeadSummary[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [listError, setListError] = useState<string | null>(null);
	const [unauthorized, setUnauthorized] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	/** The unfiltered size of the sweep queue — the badge, deliberately ignoring the search. */
	const [toSendCount, setToSendCount] = useState<number | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	/** The most recent successful save, handed to Insights so its rows update in place. */
	const [lastChanged, setLastChanged] = useState<LeadPatchResponse | null>(null);

	const [devAuth, setDevAuthState] = useState(() => getDevAuth());
	const devHost = isLocalDevHost();

	const onUnauthorized = useCallback(() => {
		setUnauthorized(true);
		setSelectedId(null);
	}, []);

	const query = useMemo<LeadQuery>(() => {
		const q: LeadQuery = { limit: PAGE_SIZE };
		if (tab === 'to-send') q.result_sent = 0;
		const term = debouncedSearch.trim();
		if (term) q.q = term;
		return q;
	}, [tab, debouncedSearch]);

	// The list. Aborts in flight when the query changes, so a fast typist never sees an
	// older response land after a newer one.
	useEffect(() => {
		if (unauthorized || tab === 'insights') return;
		const ac = new AbortController();
		setLoading(true);
		setListError(null);

		listLeads(query, ac.signal)
			.then((res) => {
				if (ac.signal.aborted) return;
				setLeads(res.leads);
				setTotal(res.total);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (ac.signal.aborted) return;
				if (err instanceof AdminApiError && err.status === 401) {
					setLoading(false);
					return onUnauthorized();
				}
				setListError(err instanceof Error ? err.message : 'Something went wrong.');
				setLoading(false);
			});

		return () => ac.abort();
	}, [query, reloadKey, unauthorized, onUnauthorized, tab]);

	// The badge: a separate 1-row query so the number is the true size of the queue, not
	// whatever the current search happens to show.
	const refreshBadge = useCallback(() => {
		listLeads({ result_sent: 0, limit: 1 })
			.then((res) => setToSendCount(res.total))
			.catch(() => {
				/* the badge is a convenience; a failure here must not take over the screen */
			});
	}, []);

	useEffect(() => {
		if (unauthorized) return;
		refreshBadge();
	}, [refreshBadge, unauthorized, reloadKey]);

	/**
	 * A save landed. Patch the row in place rather than refetching: on the "To send" tab a
	 * lead just marked sent would otherwise vanish mid-read. It stays put, greyed with a
	 * tick, and Refresh (or switching tabs) clears it from the queue.
	 */
	const onLeadChanged = useCallback(
		(updated: LeadPatchResponse) => {
			setLeads((rows) =>
				rows.map((r) =>
					r.id === updated.id
						? { ...r, result_sent: updated.result_sent, followup_status: updated.followup_status, outcome: updated.outcome }
						: r,
				),
			);
			setLastChanged(updated);
			refreshBadge();
		},
		[refreshBadge],
	);

	const selectedIndex = selectedId ? leads.findIndex((l) => l.id === selectedId) : -1;
	const hasNext = selectedIndex >= 0 && selectedIndex < leads.length - 1;
	const goNext = useCallback(() => {
		setSelectedId((current) => {
			const i = leads.findIndex((l) => l.id === current);
			return i >= 0 && i < leads.length - 1 ? leads[i + 1].id : current;
		});
	}, [leads]);

	const emptyKind: EmptyKind = debouncedSearch.trim() ? 'no-match' : tab === 'to-send' ? 'all-caught-up' : 'no-leads';

	// ── Signed out ────────────────────────────────────────────────────────────────
	if (unauthorized) {
		return (
			<main className="ad-shell ad-shell-gate">
				<h1 className="ad-title">Forge leads</h1>
				{devHost ? (
					<DevSignIn
						onSignedIn={(auth) => {
							setDevAuthState(auth);
							setUnauthorized(false);
							setReloadKey((k) => k + 1);
						}}
					/>
				) : (
					<div className="al-state">
						<p className="al-state-title">Your Access session expired</p>
						<p className="al-state-body">Reload the page to sign in again.</p>
						<button type="button" className="ad-btn ad-btn-primary" onClick={() => location.reload()}>
							Reload
						</button>
					</div>
				)}
			</main>
		);
	}

	// ── The dashboard ─────────────────────────────────────────────────────────────
	return (
		<main className={`ad-shell${selectedId ? ' is-detail-open' : ''}`}>
			<header className="ad-header">
				<div className="ad-header-top">
					<h1 className="ad-title">Forge leads</h1>
					{devAuth ? (
						<span className="ad-devbadge">
							dev sign-in · {devAuth.email}
							<button
								type="button"
								className="ad-link"
								onClick={() => {
									clearDevAuth();
									setDevAuthState(null);
									onUnauthorized();
								}}
							>
								sign out
							</button>
						</span>
					) : null}
				</div>

				{/* Job 1: always visible, always first. */}
				<div className="ad-search">
					<label htmlFor="ad-search-input" className="al-sr">
						Search leads by first name or phone number
					</label>
					<input
						id="ad-search-input"
						type="search"
						className="ad-search-input"
						placeholder="Search a name or phone number…"
						value={search}
						onChange={(e) => {
						setSearch(e.target.value);
						// Searching from Insights means "find me this person" — switch to the tab that shows them.
						if (e.target.value.trim() && tab === 'insights') setTab('all');
					}}
						autoComplete="off"
					/>
					{search ? (
						<button type="button" className="ad-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
							×
						</button>
					) : null}
				</div>

				<nav className="ad-tabs" aria-label="Lead views">
					<button
						type="button"
						className={`ad-tab${tab === 'to-send' ? ' is-active' : ''}`}
						aria-current={tab === 'to-send' ? 'page' : undefined}
						onClick={() => {
							setTab('to-send');
							setSelectedId(null);
						}}
					>
						To send
						{toSendCount !== null ? <span className="ad-badge mono">{toSendCount}</span> : null}
					</button>
					<button
						type="button"
						className={`ad-tab${tab === 'all' ? ' is-active' : ''}`}
						aria-current={tab === 'all' ? 'page' : undefined}
						onClick={() => {
							setTab('all');
							setSelectedId(null);
						}}
					>
						All leads
					</button>
					<button
						type="button"
						className={`ad-tab${tab === 'insights' ? ' is-active' : ''}`}
						aria-current={tab === 'insights' ? 'page' : undefined}
						onClick={() => {
							setTab('insights');
							setSelectedId(null);
						}}
					>
						Insights
					</button>
					<button
						type="button"
						className="ad-refresh"
						onClick={() => {
							setSelectedId(null);
							setReloadKey((k) => k + 1);
						}}
					>
						Refresh
					</button>
				</nav>
			</header>

			<div className="ad-body">
				<div className="ad-list-pane">
					{tab === 'insights' ? (
						<Insights
							onSelectLead={(lead) => setSelectedId(lead.id)}
							onUnauthorized={onUnauthorized}
							reloadKey={reloadKey}
							lastChanged={lastChanged}
						/>
					) : (
						<LeadsList
							leads={leads}
							loading={loading}
							error={listError}
							selectedId={selectedId}
							onSelect={(lead) => setSelectedId(lead.id)}
							emptyKind={emptyKind}
							total={total}
						/>
					)}
				</div>

				{selectedId ? (
					<LeadDetail
						key={selectedId}
						leadId={selectedId}
						onClose={() => setSelectedId(null)}
						onChanged={onLeadChanged}
						onNext={goNext}
						hasNext={hasNext}
						onUnauthorized={onUnauthorized}
					/>
				) : null}
			</div>
		</main>
	);
}

/**
 * LOCAL DEV ONLY. This component is rendered only when isLocalDevHost() is true, so a
 * deployed build can never show it — and even if it somehow did, the Worker refuses the
 * bypass unless DEV_ADMIN_SECRET is set (it is never deployed) and ACCESS_AUD is not.
 */
function DevSignIn({ onSignedIn }: { onSignedIn: (auth: { secret: string; email: string }) => void }) {
	const [secret, setSecret] = useState('');
	const [email, setEmail] = useState('');
	const firstField = useRef<HTMLInputElement>(null);

	useEffect(() => firstField.current?.focus(), []);

	return (
		<form
			className="ad-devsignin"
			onSubmit={(e) => {
				e.preventDefault();
				const auth = { secret: secret.trim(), email: email.trim() };
				if (!auth.secret || !auth.email) return;
				setDevAuth(auth);
				onSignedIn(auth);
			}}
		>
			<p className="ad-devsignin-flag">Local development sign-in</p>
			<p className="ad-devsignin-body">
				Cloudflare Access is not wired up yet, so on <span className="mono">localhost</span> the admin API accepts a shared dev secret
				instead. This panel exists only on localhost, and the Worker refuses these headers entirely once Access is configured — so it
				cannot work on the live site.
			</p>

			<div className="ad-field">
				<label htmlFor="dev-secret">
					DEV_ADMIN_SECRET <span className="ad-hint">(from your .dev.vars)</span>
				</label>
				<input
					id="dev-secret"
					ref={firstField}
					type="password"
					value={secret}
					onChange={(e) => setSecret(e.target.value)}
					autoComplete="off"
				/>
			</div>

			<div className="ad-field">
				<label htmlFor="dev-email">
					ADMIN_EMAIL <span className="ad-hint">(must match .dev.vars exactly)</span>
				</label>
				<input id="dev-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
			</div>

			<button type="submit" className="ad-btn ad-btn-primary">
				Sign in locally
			</button>
		</form>
	);
}
