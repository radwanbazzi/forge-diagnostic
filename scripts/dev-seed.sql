-- Local-only demo data for the /admin insights screen (F-M3b).
--
-- WHY THIS EXISTS: the insights screen ships before the site has any traffic, so there is
-- no other way to see the funnel, the went-quiet list or the audience mix with real shapes
-- in them. This fills the LOCAL D1 only.
--
--   Load:   npx wrangler d1 execute forge_diagnostic --local --file scripts/dev-seed.sql
--   Clear:  npx wrangler d1 execute forge_diagnostic --local --file scripts/dev-seed-clear.sql
--
-- NEVER run this against --remote. Every row it writes is tagged `source = 'dev-seed'`,
-- and the clear script deletes only rows carrying that tag, so real submissions are never
-- touched even if the two are somehow mixed.
--
-- The story it tells: 30 students opened the quiz. A few trickle away through the
-- questions, 7 give up on Q7 (the quadratic), 20 reach the contact screen, and 8 of those
-- refuse to hand over a phone number. 12 finish. Of those 12, 5 tapped WhatsApp and 7
-- went quiet.

-- ── Analytics events: the funnel ────────────────────────────────────────────
-- 30 sessions start; sessions are numbered s01..s30 and drop out at known points.
INSERT INTO events (id, session_id, created_at, type, question_index, meta)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 30),
q(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM q WHERE n < 17),
-- How far each session got, as the last question number it reached.
reach(i, last_q) AS (
	SELECT i,
		CASE
			WHEN i <= 20 THEN 17  -- 20 sessions get all the way to the contact screen
			WHEN i <= 27 THEN 7   -- 7 sessions give up on Q7, the quadratic
			WHEN i <= 29 THEN 3   -- 2 sessions stop at Q3
			ELSE 5                -- 1 session stops at Q5
		END
	FROM seq
)
SELECT
	'seed-' || r.i || '-a' || q.n,
	'dev-seed-s' || printf('%02d', r.i),
	1757500000000 + r.i * 60000 + q.n * 1000,
	'advance',
	q.n,
	NULL
FROM reach r JOIN q ON q.n <= r.last_q;

-- 'start' for all 30.
INSERT INTO events (id, session_id, created_at, type, question_index, meta)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 30)
SELECT 'seed-' || i || '-start', 'dev-seed-s' || printf('%02d', i), 1757500000000 + i * 60000, 'start', NULL, NULL FROM seq;

-- 'contact_reached' for the 20 who finished the questions.
INSERT INTO events (id, session_id, created_at, type, question_index, meta)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 20)
SELECT 'seed-' || i || '-contact', 'dev-seed-s' || printf('%02d', i), 1757500000000 + i * 60000 + 40000, 'contact_reached', NULL, NULL FROM seq;

-- 'completed' for the 12 who actually handed over a name and number.
INSERT INTO events (id, session_id, created_at, type, question_index, meta)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 12)
SELECT 'seed-' || i || '-done', 'dev-seed-s' || printf('%02d', i), 1757500000000 + i * 60000 + 50000, 'completed', NULL, NULL FROM seq;

-- 'whatsapp_clicked' for 5 of the 12 — the other 7 are the "went quiet" list.
INSERT INTO events (id, session_id, created_at, type, question_index, meta)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 5)
SELECT 'seed-' || i || '-wa', 'dev-seed-s' || printf('%02d', i), 1757500000000 + i * 60000 + 60000, 'whatsapp_clicked', NULL, NULL FROM seq;

-- ── The 12 leads those completions produced ─────────────────────────────────
-- Names are obviously fake and every row is tagged source='dev-seed'.
INSERT INTO diagnostics (
	id, session_id, created_at, source, completion_time_sec,
	skills_time_total_sec, skills_timed_out_count, skills_timings,
	target_score, grade, test_date, sat_history,
	q5, q6, q7, q8, q9, q10, q11, q12,
	hours_per_week, timing, review_mistakes, prep_status, worried_about,
	first_name, whatsapp, school, respondent_type, consent,
	math_raw, rw_raw, overall_band, confidence, archetype,
	target_num, current_mid, gap, timeline_verdict, recommended_program,
	lead_score, lead_status, result_payload,
	result_sent, followup_status, outcome, notes
)
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 12)
SELECT
	'dev-seed-' || printf('%08d', i) || '-0000-4000-8000-000000000000',
	'dev-seed-s' || printf('%02d', i),
	1757500000000 + i * 3600000,
	'dev-seed',
	380 + i * 11,
	290 + i * 7,
	i % 3,
	NULL,
	CASE i % 4 WHEN 0 THEN '1450+' WHEN 1 THEN '1350–1449' WHEN 2 THEN '1250–1349' ELSE 'Not sure yet' END,
	CASE i % 3 WHEN 0 THEN 'Grade 12' WHEN 1 THEN 'Grade 11' ELSE 'Grade 10' END,
	CASE i % 3 WHEN 0 THEN 'Within 8 weeks' WHEN 1 THEN '2–4 months' ELSE 'More than 6 months' END,
	CASE i % 3 WHEN 0 THEN 'Never taken one' WHEN 1 THEN 'Practice only — 1100–1299' ELSE 'Official SAT — 1100–1299' END,
	'C) 300', 'B) In addition', 'B) 4', 'B) self-reproach', 'B) 96%', 'B) ;', 'A) 12',
	'B) Food may have been prepared or eaten outside the walled area.',
	CASE i % 3 WHEN 0 THEN 'Less than 2' WHEN 1 THEN '2–4' ELSE '5–8' END,
	CASE i % 3 WHEN 0 THEN 'Run out of time and rush or guess the last questions' WHEN 1 THEN 'Finish right on time' ELSE 'Finish with time to spare' END,
	CASE i % 3 WHEN 0 THEN 'Rarely' WHEN 1 THEN 'Sometimes' ELSE 'Almost always' END,
	CASE i % 3 WHEN 0 THEN 'On my own' WHEN 1 THEN 'Through my school' ELSE 'Not really preparing yet' END,
	CASE i % 3 WHEN 0 THEN 'Running out of time' WHEN 1 THEN 'Math' ELSE 'Reading' END,
	'Demo ' || printf('%02d', i),
	'+9617000' || printf('%04d', i),
	CASE i % 3 WHEN 0 THEN 'International College' WHEN 1 THEN 'Rawdah High School' ELSE NULL END,
	CASE i % 5 WHEN 0 THEN 'parent' ELSE 'student' END,
	1,
	4 + (i % 5), 5 + (i % 4),
	CASE i % 3 WHEN 0 THEN '1150-1320' WHEN 1 THEN '1040-1200' ELSE '1250-1400' END,
	CASE i % 3 WHEN 0 THEN 'Moderate' WHEN 1 THEN 'Low-Moderate' ELSE 'Low' END,
	CASE i % 6
		WHEN 0 THEN 'Time-Pressured'
		WHEN 1 THEN 'Plateaued Retaker'
		WHEN 2 THEN 'Lopsided (Math-weak)'
		WHEN 3 THEN 'Untested Unknown'
		WHEN 4 THEN 'Shaky Grammarian'
		ELSE 'Lopsided (R&W-weak)'
	END,
	1400, 1220,
	CASE i % 4 WHEN 3 THEN NULL ELSE 120 + i * 10 END,
	CASE i % 3 WHEN 0 THEN 'Tight but doable' WHEN 1 THEN 'Reasonable' ELSE 'Comfortable' END,
	CASE WHEN i % 3 = 2 THEN '$80 SAT Essentials' ELSE '$130 SAT Accelerator' END,
	CASE i % 3 WHEN 0 THEN 9.0 WHEN 1 THEN 6.0 ELSE 3.0 END,
	CASE i % 3 WHEN 0 THEN 'HOT' WHEN 1 THEN 'WARM' ELSE 'COLD' END,
	'{"band":{"range":"1150-1320","confidence":"Moderate","sub":"Based on 8 questions."},"profile":{"archetype":"Time-Pressured","statement":"You are Time-Pressured.","meaning":"You know the material; the clock beats you."},"reframe":{"kind":"reframe","text":"This is a pacing problem, not an ability problem."},"section_read":"Math and R&W are close together.","top_fixes":["Timed sets","A mistake log","Two full practice tests"],"timeline":{"verdict":"Tight but doable","line":"Ten weeks is enough if you start now."},"recommendation":{"program":"$130 SAT Accelerator","text":"Built for pacing.","guarantee":null},"cta":{"whatsapp_prefill":"Hi Forge","whatsapp_url":null},"meta":{"first_name":"Demo","overall_band":"1150-1320","archetype":"Time-Pressured","lead_status":"HOT","recommended_program":"$130 SAT Accelerator"}}',
	CASE WHEN i <= 4 THEN 1 ELSE 0 END,
	CASE i % 4 WHEN 0 THEN 'Msg1 sent' WHEN 1 THEN 'Replied' ELSE 'None' END,
	CASE i WHEN 1 THEN 'Enrolled $130' WHEN 2 THEN 'Enrolled $80' WHEN 3 THEN 'Lost' ELSE '-' END,
	NULL
FROM seq;
