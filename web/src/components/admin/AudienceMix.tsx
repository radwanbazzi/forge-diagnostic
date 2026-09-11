/**
 * "Who the quiz is attracting" (F-M3b, design spec §6.3).
 *
 * Deliberately the smallest block on the screen — the spec calls it explicitly low
 * priority. Three mixes (lead status, archetype, recommended programme) plus the three
 * headline rates, all straight off the analytics endpoint's COUNT/GROUP BY aggregates.
 *
 * Presentational only. Every mix shares one row component so a new aggregate is one line.
 */
import { percent } from '../../lib/funnel';
import type { Analytics } from '../../lib/adminApi';

/** One labelled proportion bar. */
function MixRow({ label, n, total, tone }: { label: string; n: number; total: number; tone?: string }) {
	const share = total > 0 ? n / total : 0;
	return (
		<li className="am-row">
			<span className="am-row-label">{label}</span>
			<span className="am-row-track" aria-hidden="true">
				<span className={`am-row-fill${tone ? ` am-tone-${tone}` : ''}`} style={{ width: `${share * 100}%` }} />
			</span>
			<span className="am-row-n mono">
				{n}
				<span className="am-row-share"> · {percent(share)}</span>
			</span>
		</li>
	);
}

function Mix({ title, entries, total, tone }: { title: string; entries: Array<[string, number]>; total: number; tone?: (k: string) => string | undefined }) {
	if (entries.length === 0) return null;
	return (
		<div className="am-mix">
			<h3 className="am-mix-title">{title}</h3>
			<ul className="am-mix-list">
				{entries.map(([k, n]) => (
					<MixRow key={k} label={k} n={n} total={total} tone={tone?.(k)} />
				))}
			</ul>
		</div>
	);
}

export default function AudienceMix({ analytics }: { analytics: Analytics }) {
	const leads = analytics.totals.leads;

	// Mixes come back as objects keyed by value; sort biggest-first so the shape reads at a
	// glance. Status keeps its natural HOT → COLD order instead, which is more meaningful.
	const statusEntries: Array<[string, number]> = [
		['HOT', analytics.status_mix.HOT ?? 0],
		['WARM', analytics.status_mix.WARM ?? 0],
		['COLD', analytics.status_mix.COLD ?? 0],
	];
	const byCount = (m: Record<string, number>): Array<[string, number]> => Object.entries(m).sort((a, b) => b[1] - a[1]);

	if (leads === 0) {
		return (
			<section className="ai-block ai-block-compact" aria-labelledby="ai-mix-title">
				<header className="ai-block-head">
					<h2 className="ai-block-title" id="ai-mix-title">
						Who the quiz is attracting
					</h2>
				</header>
				<div className="ai-empty">
					<p className="ai-empty-title">No finished diagnostics yet</p>
					<p className="ai-empty-body">
						Once students start finishing, this shows the shape of your audience in three cuts: how many come out HOT / WARM / COLD, which
						learner profiles are most common (Time-Pressured, Plateaued Retaker, and so on), and how the $80 / $130 recommendation splits.
						Underneath it, the three rates worth watching: completion, WhatsApp taps, and enrolments.
					</p>
					<p className="ai-empty-need">
						<strong>To fill this in:</strong> one completed diagnostic. Every one of these is computed from the saved lead, so a single
						finished student populates all three mixes at once.
					</p>
				</div>
			</section>
		);
	}

	return (
		<section className="ai-block ai-block-compact" aria-labelledby="ai-mix-title">
			<header className="ai-block-head">
				<h2 className="ai-block-title" id="ai-mix-title">
					Who the quiz is attracting
				</h2>
				<p className="ai-block-headline">
					{leads} finished {leads === 1 ? 'diagnostic' : 'diagnostics'} so far.
				</p>
			</header>

			<div className="am-rates">
				<p className="am-rate">
					<span className="am-rate-n mono">{percent(analytics.completion_rate)}</span>
					<span className="am-rate-label">finish the quiz once they start</span>
				</p>
				<p className="am-rate">
					<span className="am-rate-n mono">{percent(analytics.whatsapp_click_rate)}</span>
					<span className="am-rate-label">tap WhatsApp after seeing their result</span>
				</p>
				<p className="am-rate">
					<span className="am-rate-n mono">{percent(analytics.enrollment_rate)}</span>
					<span className="am-rate-label">have enrolled ({analytics.totals.enrolled} of {leads})</span>
				</p>
			</div>

			<div className="am-mixes">
				<Mix title="Lead status" entries={statusEntries} total={leads} tone={(k) => k.toLowerCase()} />
				<Mix title="Learner profile" entries={byCount(analytics.archetype_mix)} total={leads} />
				<Mix title="Recommended programme" entries={byCount(analytics.program_mix)} total={leads} />
			</div>
		</section>
	);
}
