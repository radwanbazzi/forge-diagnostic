/**
 * Forge SAT Diagnostic — the on-screen RESULT (F-M2).
 *
 * Renders the server's `result_payload` VERBATIM, in the exact order of PRD §8:
 *   1. estimated score band + Score Gauge motif (§13)
 *   2. confidence + caveat line
 *   3. profile/archetype + its one-line meaning
 *   4. the reframe line
 *   5. section read (Math vs R&W standing)
 *   6. ranked top-3 fixes
 *   7. timeline verdict
 *   8. program recommendation ($80 / $130) tied to the bottleneck
 *   + primary CTA: WhatsApp button (pre-filled) and the Whish payment note
 *
 * NOTHING is recomputed here — every string comes from the payload the Worker built and
 * persisted at submit time. No scoring logic or answer key exists in this file (or bundle).
 *
 * Analytics (fire-and-forget, never blocking): `completed` once when the screen mounts,
 * `whatsapp_clicked` when the CTA is tapped.
 */
import { useEffect, useRef } from 'react';
import { postEvent, type ResultPayload } from '../lib/api';
import './result.css';

// The SAT total scale the gauge is drawn against (400–1600).
const SAT_MIN = 400;
const SAT_MAX = 1600;
const GAUGE_TICKS = [400, 700, 1000, 1300, 1600];

/** Pull the low/high numbers out of a band string like "1150-1320" (any separator). */
function parseBand(range: string): { low: number; high: number } | null {
	const nums = (range.match(/\d+/g) ?? []).map(Number);
	if (nums.length < 2) return null;
	let [low, high] = [nums[0], nums[1]];
	if (low > high) [low, high] = [high, low];
	return { low, high };
}

/** Position (0–100%) of a score on the 400–1600 axis. */
function pct(v: number): number {
	const clamped = Math.max(SAT_MIN, Math.min(SAT_MAX, v));
	return ((clamped - SAT_MIN) / (SAT_MAX - SAT_MIN)) * 100;
}

/** Keep the edge tick labels from overflowing the track. */
function labelTransform(p: number): string {
	if (p <= 0.01) return 'translateX(0)';
	if (p >= 99.99) return 'translateX(-100%)';
	return 'translateX(-50%)';
}

function ScoreGauge({ range }: { range: string }) {
	const band = parseBand(range);
	return (
		<div className="fr-gauge" role="img" aria-label={`Estimated SAT range ${range}, on a 400 to 1600 scale`}>
			<div className="fr-gauge-track">
				{band && (
					<div
						className="fr-gauge-band"
						style={{ left: `${pct(band.low)}%`, width: `${Math.max(2, pct(band.high) - pct(band.low))}%` }}
					/>
				)}
				{GAUGE_TICKS.map((t) => (
					<div key={t} className="fr-gauge-tick" style={{ left: `${pct(t)}%` }} />
				))}
			</div>
			<div className="fr-gauge-labels mono" aria-hidden="true">
				{GAUGE_TICKS.map((t) => (
					<span key={t} className="fr-gauge-label" style={{ left: `${pct(t)}%`, transform: labelTransform(pct(t)) }}>
						{t}
					</span>
				))}
			</div>
		</div>
	);
}

export default function ResultScreen({ payload, sessionId }: { payload: ResultPayload; sessionId: string }) {
	const { band, profile, reframe, section_read, top_fixes, timeline, recommendation, cta } = payload;

	// Fire `completed` exactly once when the result is first shown.
	const firedCompleted = useRef(false);
	useEffect(() => {
		if (firedCompleted.current) return;
		firedCompleted.current = true;
		postEvent(sessionId, 'completed');
	}, [sessionId]);

	return (
		<main className="fr-shell">
			<p className="fr-eyebrow mono">Your Forge SAT diagnostic</p>

			{/* 1 + 2 — estimated band, Score Gauge, confidence + caveat */}
			<section className="fr-band">
				<h1 className="fr-band-title">Your estimated SAT range</h1>
				<div className="fr-range mono">{band.range}</div>
				<ScoreGauge range={band.range} />
				<p className="fr-band-sub">{band.sub}</p>
			</section>

			{/* 3 — profile / archetype + one-line meaning */}
			<section className="fr-block">
				<h2 className="fr-h2">{profile.statement}</h2>
				<p className="fr-body">{profile.meaning}</p>
			</section>

			{/* 4 — the reframe (affirm vs reframe styling) */}
			<section className={`fr-reframe ${reframe.kind === 'affirm' ? 'is-affirm' : 'is-reframe'}`}>
				<p className="fr-body">{reframe.text}</p>
			</section>

			{/* 5 — section read */}
			<section className="fr-block">
				<h3 className="fr-h3">Where you stand</h3>
				<p className="fr-body">{section_read}</p>
			</section>

			{/* 6 — ranked top-3 fixes */}
			<section className="fr-block">
				<h3 className="fr-h3">Your top 3 fixes</h3>
				<ol className="fr-fixes">
					{top_fixes.map((fix, i) => (
						<li key={i} className="fr-fix">
							<span className="fr-fix-n mono" aria-hidden="true">
								{i + 1}
							</span>
							<span className="fr-fix-text">{fix}</span>
						</li>
					))}
				</ol>
			</section>

			{/* 7 — timeline verdict */}
			<section className="fr-block">
				<h3 className="fr-h3">Your timeline</h3>
				<p className="fr-body">
					<strong className="fr-verdict">{timeline.verdict}</strong> — {timeline.line}
				</p>
			</section>

			{/* 8 — program recommendation */}
			<section className="fr-rec">
				<p className="fr-rec-eyebrow mono">Recommended for you</p>
				<h3 className="fr-rec-title">{recommendation.program}</h3>
				<p className="fr-body">{recommendation.text}</p>
				{recommendation.guarantee ? <p className="fr-guarantee">{recommendation.guarantee}</p> : null}
			</section>

			{/* Primary CTA — WhatsApp (pre-filled) + Whish note. Never a broken wa.me link. */}
			<section className="fr-cta">
				{cta.whatsapp_url ? (
					<a
						className="fr-wa"
						href={cta.whatsapp_url}
						target="_blank"
						rel="noopener noreferrer"
						onClick={() => postEvent(sessionId, 'whatsapp_clicked')}
					>
						<span aria-hidden="true">💬</span> Message Forge on WhatsApp
					</a>
				) : (
					// Safe fallback when WHATSAPP_NUMBER isn't configured yet (F2.1): no broken link.
					<button type="button" className="fr-wa is-disabled" disabled aria-disabled="true">
						<span aria-hidden="true">💬</span> WhatsApp — coming soon
					</button>
				)}
				<p className="fr-whish">
					{cta.whish_note}{' '}
					{cta.whish_link ? (
						<a className="fr-whish-link" href={cta.whish_link} target="_blank" rel="noopener noreferrer">
							Pay via Whish →
						</a>
					) : null}
				</p>
			</section>
		</main>
	);
}
