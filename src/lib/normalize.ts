/**
 * Normalize an answer option for keyword matching.
 *
 * The locked questionnaire (Tab ③ of the reference spreadsheet) uses en-dashes
 * (–, U+2013) in ranges like "5–8" / "1350–1449" and an em-dash (—, U+2014) as
 * the separator in Q4 ("Official SAT — 1100–1299"). The reference scoring
 * formulas match on the numbers/keywords regardless of dash style, so we fold
 * en/em dashes to a plain hyphen and lowercase before matching. This keeps the
 * engine in lock-step with the locked wording without depending on dash typography.
 */
export function normalizeOption(s: string): string {
	return s.toLowerCase().replace(/[–—]/g, '-');
}
