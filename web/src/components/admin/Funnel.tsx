/**
 * "Where students quit" — the drop-off funnel (F-M3b, design spec §6.1).
 *
 * Presentational only: it takes a built Funnel and draws it. All the counting lives in
 * ../../lib/funnel so it can be tested without a DOM.
 *
 * The one thing this block exists to make unmistakable: the line between the QUESTIONS
 * and the CONTACT GATE. Quitting on Q8 means the quiz is too hard or too long; quitting
 * when asked for a phone number means the student does not want to be contacted. Those
 * are different problems with different fixes, so the boundary is drawn as its own loud
 * divider and the two losses are totalled separately above the bars.
 *
 * Bars are CSS widths, not a charting library — the spec rules one out for a free-tier,
 * 10ms-CPU project, and 19 horizontal bars do not need one.
 *
 * With no data the ladder still renders, greyed, with the real question text in place.
 * A blank chart would read as a broken feature; the skeleton tells the owner exactly what
 * will appear here and what has to happen to fill it in.
 */
import { SECTION_LABELS, biggestDropSentence, percent, type Funnel, type FunnelStep, type QuestionSection } from '../../lib/funnel';

/** The section heading that precedes a question step, or null if it is mid-section. */
function sectionHeadingBefore(step: FunnelStep, prev: FunnelStep | undefined): QuestionSection | null {
	if (step.kind !== 'question' || step.section === undefined) return null;
	if (prev && prev.kind === 'question' && prev.section === step.section) return null;
	return step.section;
}

function StepRow({ step, heading, hasData }: { step: FunnelStep; heading: QuestionSection | null; hasData: boolean }) {
	// Always leave a sliver of bar visible so a non-zero row reads as a row, not a gap.
	const width = hasData ? Math.max(step.share * 100, step.reached > 0 ? 1.5 : 0) : 0;

	return (
		<li className={`af-step af-step-${step.kind}${step.isBigLoss ? ' is-bigloss' : ''}${hasData ? '' : ' is-empty'}`}>
			{heading ? (
				<p className="af-section">
					<span className="af-section-text">{SECTION_LABELS[heading]}</span>
				</p>
			) : null}

			{/* The boundary the owner asked for: loud, labelled, impossible to miss. */}
			{step.kind === 'contact-gate' ? (
				<p className="af-boundary">
					<span className="af-boundary-text">Contact gate — everything below is after you ask for a name &amp; number</span>
				</p>
			) : null}

			<div className="af-step-head">
				<span className="af-step-label mono">{step.label}</span>
				<span className="af-step-detail" title={step.detail}>
					{step.detail}
				</span>
			</div>

			<div className="af-step-meter">
				<div className="af-bar-track" aria-hidden="true">
					<div className={`af-bar-fill af-bar-${step.kind}`} style={{ width: `${width}%` }} />
				</div>
				<span className="af-step-reached mono">
					{hasData ? step.reached : '—'}
					{hasData ? <span className="af-step-share"> · {percent(step.share)}</span> : null}
				</span>
			</div>

			{hasData && step.lost > 0 ? (
				<p className={`af-step-lost${step.isBigLoss ? ' is-bigloss' : ''}`}>
					<span aria-hidden="true">↓</span> {step.lost} quit here
					{step.isBigLoss ? <span className="af-bigloss-tag">one of the 3 biggest</span> : null}
				</p>
			) : null}
		</li>
	);
}

export default function FunnelBlock({ funnel }: { funnel: Funnel }) {
	const { steps, summary } = funnel;
	const hasData = summary.hasData;
	const headline = biggestDropSentence(funnel);

	// The two numbers this whole block exists to keep apart.
	const questionShare = summary.started > 0 ? summary.quitInQuestions / summary.started : 0;
	const gateShare = summary.reachedContact > 0 ? summary.quitAtContactGate / summary.reachedContact : 0;

	return (
		<section className="ai-block" aria-labelledby="ai-funnel-title">
			<header className="ai-block-head">
				<h2 className="ai-block-title" id="ai-funnel-title">
					Where students quit
				</h2>
				{hasData && headline ? <p className="ai-block-headline">{headline}</p> : null}
			</header>

			{hasData ? (
				<>
					<p className="ai-topline">
						<strong className="mono">{summary.started}</strong> started
						<span className="ai-topline-sep" aria-hidden="true">
							→
						</span>
						<strong className="mono">{summary.reachedContact}</strong> reached the contact screen
						<span className="ai-topline-sep" aria-hidden="true">
							→
						</span>
						<strong className="mono">{summary.completed}</strong> saw their result
					</p>

					{/* THE SPLIT. Two different problems, never blended into one number. */}
					<div className="af-split">
						<div className="af-split-card af-split-questions">
							<p className="af-split-n mono">{summary.quitInQuestions}</p>
							<p className="af-split-what">quit during the questions</p>
							<p className="af-split-why">
								{percent(questionShare)} of everyone who started. They never saw the contact screen — the quiz itself lost them.
							</p>
						</div>
						<div className="af-split-card af-split-gate">
							<p className="af-split-n mono">{summary.quitAtContactGate}</p>
							<p className="af-split-what">quit at the contact gate</p>
							<p className="af-split-why">
								{percent(gateShare)} of those who got there. They finished the quiz, then would not give a name and number.
							</p>
						</div>
					</div>
				</>
			) : (
				<div className="ai-empty">
					<p className="ai-empty-title">No drop-off data yet</p>
					<p className="ai-empty-body">
						This fills in on its own as students work through the quiz — nothing to set up. Every screen listed below becomes a bar
						showing how many students reached it and how many stopped there, and the three worst drops get flagged.
					</p>
					<p className="ai-empty-body">
						<strong>The number you will actually use</strong> is the split across the red line below: how many quit during the 17
						questions versus how many quit the moment you ask for a name and a WhatsApp number. The first means the quiz is too long or
						too hard; the second means they do not want to be contacted. Different problems, different fixes.
					</p>
					<p className="ai-empty-need">
						<strong>To fill this in:</strong> one student opening the diagnostic. The first bars appear within a minute of them starting.
					</p>
				</div>
			)}

			<p className="af-howto">
				<strong>How to read this.</strong> A student is counted at a screen the moment it appears. So “Q8 — 7 quit here” means seven
				students saw Q8 and never reached Q9. Counts are distinct students, not taps.
			</p>

			<ol className="af-ladder">
				{steps.map((step, i) => (
					<StepRow key={step.key} step={step} heading={sectionHeadingBefore(step, steps[i - 1])} hasData={hasData} />
				))}
			</ol>
		</section>
	);
}
