/**
 * Forge SAT Diagnostic — the interactive question flow (F-M1, front-end only).
 *
 * Presents the 22 questions from the shared config (src/lib/questions.ts) one screen at
 * a time on mobile: Section 1 (goal, 4Q) → Section 2 (skills, 8Q) → Section 3 (habits, 5Q),
 * then a single Section 4 contact-capture screen (first name, WhatsApp, school[opt],
 * student/parent, consent).
 *
 * On submit we assemble the exact object POST /api/diagnostic/submit expects
 * (see src/lib/validation.ts), send it, and render the server's result_payload via
 * <ResultScreen> (F-M2). The client NEVER scores anything — the result is computed and
 * persisted server-side and returned whole. A loading state covers the request and a
 * friendly, retryable error state covers failures (the student never sees a raw error).
 *
 * The question text/options are imported verbatim from the pinned config — never reworded.
 */
import { useEffect, useRef, useState } from 'react';
import {
	QUESTIONS,
	CONSENT_TEXT,
	RESPONDENT_OPTIONS,
	type Question,
} from '../../../src/lib/questions';
import ResultScreen from './ResultScreen';
import { submitDiagnostic, type ResultPayload } from '../lib/api';
import './diagnostic.css';
import './result.css';

// ── Section headings (PRD §3.1). Keyed by the `section` field on each question. ──
const SECTION_TITLES: Record<number, string> = {
	1: 'About you & your goal',
	2: 'Quick skills check',
	3: 'How you study',
	4: 'Almost there',
};

// The one-per-screen questions are the choice questions in sections 1–3 (Q1–Q17).
// Section 4 (Q18–Q22) is rendered together on the final contact screen.
const CHOICE_QUESTIONS: Question[] = QUESTIONS.filter((q) => q.section !== 4);
const TOTAL_STEPS = CHOICE_QUESTIONS.length + 1; // +1 for the contact screen

// Pull the exact contact-field prompts out of the config so wording stays in lock-step.
const contactPrompt = (field: string): string =>
	QUESTIONS.find((q) => q.field === field)?.prompt ?? field;

type RespondentType = (typeof RESPONDENT_OPTIONS)[number];

interface Contact {
	first_name: string;
	whatsapp: string;
	school: string;
	respondent_type: RespondentType | '';
	consent: boolean;
}

export default function DiagnosticFlow() {
	// step: 0..(CHOICE_QUESTIONS.length-1) are the question screens;
	// step === CHOICE_QUESTIONS.length is the contact screen.
	const [step, setStep] = useState(0);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [contact, setContact] = useState<Contact>({
		first_name: '',
		whatsapp: '',
		school: '',
		respondent_type: '',
		consent: false,
	});
	// idle → loading (request in flight) → result (payload rendered) | error (retryable).
	const [status, setStatus] = useState<'idle' | 'loading' | 'result' | 'error'>('idle');
	const [result, setResult] = useState<ResultPayload | null>(null);
	const startedAt = useRef<number>(Date.now());
	// One stable session id per attempt: shared by the submission and every analytics event.
	const sessionId = useRef<string>(crypto.randomUUID());
	// Locks the 160ms auto-advance below so a burst of taps can't queue more than one
	// screen change (see selectOption).
	const advancing = useRef(false);

	const onContactScreen = step === CHOICE_QUESTIONS.length;
	const currentQuestion = onContactScreen ? null : CHOICE_QUESTIONS[step];

	// Progress: how many of the TOTAL_STEPS screens are complete-and-behind us.
	const progressPct = Math.round((step / TOTAL_STEPS) * 100);

	function goBack() {
		if (step > 0) {
			setStep((s) => s - 1);
		} else {
			// First screen → back to the landing page.
			window.location.href = '/';
		}
	}

	function selectOption(field: string, value: string) {
		// Ignore taps while a screen change is already pending. Without this lock, tapping
		// faster than the 160ms transition queued a SECOND advance, so the next question was
		// skipped (flashed with no answer recorded) → a missing answer → the submit 400'd.
		if (advancing.current) return;
		advancing.current = true;
		setAnswers((prev) => ({ ...prev, [field]: value }));
		// Smooth auto-advance to the next screen after a brief visual confirm. Advance ONLY
		// from the screen this tap was made on (`from`), so at most one step is ever crossed.
		const from = step;
		window.setTimeout(() => {
			setStep((s) => (s === from ? Math.min(s + 1, CHOICE_QUESTIONS.length) : s));
			advancing.current = false;
		}, 160);
	}

	// Contact-screen validity: required fields present + consent ticked (school is optional).
	const contactValid =
		contact.first_name.trim().length > 0 &&
		contact.whatsapp.trim().length > 0 &&
		contact.respondent_type !== '' &&
		contact.consent === true;

	async function handleSubmit() {
		// Guard: invalid contact, or a request already in flight (double-tap safety).
		if (!contactValid || status === 'loading') return;

		// Defence in depth: never POST an incomplete set of answers. If a question was ever
		// left unanswered, jump the student back to the first one instead of sending a broken
		// payload and dead-ending on "Something went wrong" (which silently loses the lead).
		const firstUnanswered = CHOICE_QUESTIONS.findIndex((q) => !answers[q.field]);
		if (firstUnanswered !== -1) {
			setStep(firstUnanswered);
			return;
		}

		// Assemble the EXACT shape POST /api/diagnostic/submit expects (validation.ts).
		const submission = {
			session_id: sessionId.current,
			completion_time_sec: Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
			answers: {
				target_score: answers.target_score,
				grade: answers.grade,
				test_date: answers.test_date,
				sat_history: answers.sat_history,
				q5: answers.q5,
				q6: answers.q6,
				q7: answers.q7,
				q8: answers.q8,
				q9: answers.q9,
				q10: answers.q10,
				q11: answers.q11,
				q12: answers.q12,
				hours_per_week: answers.hours_per_week,
				timing: answers.timing,
				review_mistakes: answers.review_mistakes,
				prep_status: answers.prep_status,
				worried_about: answers.worried_about,
			},
			contact: {
				first_name: contact.first_name.trim(),
				whatsapp: contact.whatsapp.trim(),
				// school is optional — only include it when provided.
				...(contact.school.trim() ? { school: contact.school.trim() } : {}),
				respondent_type: contact.respondent_type as RespondentType,
				consent: true,
			},
		};

		// Send to the backend: it scores + persists the lead, then returns result_payload.
		setStatus('loading');
		try {
			const { result_payload } = await submitDiagnostic(submission);
			setResult(result_payload);
			setStatus('result');
		} catch {
			// Never surface a raw error; offer a retry (same session_id → backend upserts,
			// so a retry never creates a duplicate lead).
			setStatus('error');
		}
	}

	// ── Result screen: render the server's payload verbatim (nothing recomputed here) ──
	if (status === 'result' && result) {
		return <ResultScreen payload={result} sessionId={sessionId.current} />;
	}

	// ── Loading: request in flight ─────────────────────────────────────────────────
	if (status === 'loading') {
		return (
			<main className="fd-shell">
				<div className="fd-status" role="status" aria-live="polite">
					<div className="fd-spinner" aria-hidden="true" />
					<h1 className="fd-status-title">Scoring your answers…</h1>
					<p className="fd-status-body">Building your personalized result. This takes just a moment.</p>
				</div>
			</main>
		);
	}

	// ── Error: friendly, retryable (the student never sees a raw error or blank screen) ──
	if (status === 'error') {
		return (
			<main className="fd-shell">
				<div className="fd-status" role="alert">
					<h1 className="fd-status-title">Something went wrong</h1>
					<p className="fd-status-body">
						We couldn't reach our servers to build your result. Your answers are still here — please try again.
					</p>
					<button type="button" className="fd-retry" onClick={handleSubmit}>
						Try again →
					</button>
				</div>
			</main>
		);
	}

	return (
		<main className="fd-shell">
			{/* Persistent progress bar */}
			<div className="fd-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
				<div className="fd-progress-fill" style={{ width: `${progressPct}%` }} />
			</div>

			<div className="fd-topline">
				<span className="fd-section mono">
					{onContactScreen ? SECTION_TITLES[4] : SECTION_TITLES[currentQuestion!.section]}
				</span>
				<span className="fd-count mono">
					{onContactScreen
						? 'Last step'
						: `Question ${step + 1} of ${CHOICE_QUESTIONS.length}`}
				</span>
			</div>

			{onContactScreen ? (
				<ContactScreen
					contact={contact}
					setContact={setContact}
					valid={contactValid}
					onSubmit={handleSubmit}
					onBack={goBack}
				/>
			) : (
				<QuestionScreen
					question={currentQuestion!}
					selected={answers[currentQuestion!.field]}
					onSelect={(value) => selectOption(currentQuestion!.field, value)}
					onBack={goBack}
				/>
			)}
		</main>
	);
}

// ── One choice question, one screen ──────────────────────────────────────────────
function QuestionScreen({
	question,
	selected,
	onSelect,
	onBack,
}: {
	question: Question;
	selected: string | undefined;
	onSelect: (value: string) => void;
	onBack: () => void;
}) {
	// On each new question screen, move focus to the heading so keyboard and
	// screen-reader users are carried to the new question (auto-advance would
	// otherwise drop focus back to the top of the page). :focus-visible does not
	// fire for programmatic focus, so no ring flashes for mouse users.
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus();
	}, [question.n]);

	return (
		<div className="fd-card" key={question.n}>
			<button type="button" className="fd-back" onClick={onBack}>
				← Back
			</button>

			<h1 className="fd-question" tabIndex={-1} ref={headingRef}>
				{question.prompt}
			</h1>

			<div className="fd-options">
				{(question.options ?? []).map((opt) => {
					const isSelected = selected === opt;
					return (
						<button
							key={opt}
							type="button"
							className={`fd-option${isSelected ? ' is-selected' : ''}`}
							aria-pressed={isSelected}
							onClick={() => onSelect(opt)}
						>
							<span className="fd-option-text">{opt}</span>
							<span className="fd-option-tick" aria-hidden="true">
								✓
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ── Section 4: contact capture (single screen) ───────────────────────────────────
function ContactScreen({
	contact,
	setContact,
	valid,
	onSubmit,
	onBack,
}: {
	contact: Contact;
	setContact: React.Dispatch<React.SetStateAction<Contact>>;
	valid: boolean;
	onSubmit: () => void;
	onBack: () => void;
}) {
	const set = <K extends keyof Contact>(key: K, value: Contact[K]) =>
		setContact((prev) => ({ ...prev, [key]: value }));

	// Carry focus to the heading when the contact screen appears (same reasoning
	// as the question screens above).
	const headingRef = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		headingRef.current?.focus();
	}, []);

	return (
		<div className="fd-card">
			<button type="button" className="fd-back" onClick={onBack}>
				← Back
			</button>

			<h1 className="fd-question" tabIndex={-1} ref={headingRef}>
				Where should we send your results?
			</h1>
			<p className="fd-help">Your result appears on the next screen. We use these details only to send your results and Forge updates.</p>

			<form
				className="fd-form"
				onSubmit={(e) => {
					e.preventDefault();
					onSubmit();
				}}
			>
				<label className="fd-field">
					<span className="fd-label">{contactPrompt('first_name')}</span>
					<input
						type="text"
						className="fd-input"
						autoComplete="given-name"
						value={contact.first_name}
						onChange={(e) => set('first_name', e.target.value)}
						required
					/>
				</label>

				<label className="fd-field">
					<span className="fd-label">{contactPrompt('whatsapp')}</span>
					<input
						type="tel"
						inputMode="tel"
						className="fd-input"
						autoComplete="tel"
						placeholder="e.g. 70 123 456"
						value={contact.whatsapp}
						onChange={(e) => set('whatsapp', e.target.value)}
						required
					/>
				</label>

				<label className="fd-field">
					<span className="fd-label">
						{contactPrompt('school')} <span className="fd-optional">(optional)</span>
					</span>
					<input
						type="text"
						className="fd-input"
						autoComplete="organization"
						value={contact.school}
						onChange={(e) => set('school', e.target.value)}
					/>
				</label>

				<fieldset className="fd-field fd-fieldset">
					<legend className="fd-label">{contactPrompt('respondent_type')}</legend>
					<div className="fd-segment">
						{RESPONDENT_OPTIONS.map((opt) => (
							<button
								key={opt}
								type="button"
								className={`fd-segment-btn${contact.respondent_type === opt ? ' is-selected' : ''}`}
								aria-pressed={contact.respondent_type === opt}
								onClick={() => set('respondent_type', opt)}
							>
								{opt}
							</button>
						))}
					</div>
				</fieldset>

				<label className="fd-consent">
					<input
						type="checkbox"
						className="fd-checkbox"
						checked={contact.consent}
						onChange={(e) => set('consent', e.target.checked)}
					/>
					<span className="fd-consent-text">{CONSENT_TEXT}</span>
				</label>

				<p className="fd-privacy">
					We use these details only to send your results and Forge updates — never sold, never shared.{' '}
					{/* Opens in a new tab so your answers aren't lost. */}
					<a href="/privacy" target="_blank" rel="noopener noreferrer">
						Read our privacy note
					</a>
					.
				</p>

				<button type="submit" className="fd-submit" disabled={!valid}>
					See my results →
				</button>
			</form>
		</div>
	);
}
