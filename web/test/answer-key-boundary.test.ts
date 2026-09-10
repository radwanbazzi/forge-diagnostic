/**
 * Guards the project's single most important security rule (CLAUDE.md): the scoring
 * answer key is server-only and must never reach a student's browser.
 *
 * Enforced two ways: nothing under web/src may import `answerKey`, and the ONLY module
 * web/src may import out of the server tree (src/lib) is `questions.ts`, which is
 * deliberately browser-safe. Any new cross-boundary import fails the build until it is
 * added to ALLOWED_SERVER_IMPORTS with a deliberate decision.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * web/src, resolved from the working directory. Vitest runs this suite with the web/
 * package as its root (`npm --prefix web test`), but tolerate being run from the repo
 * root too. `import.meta.url` is not a file: URL under the jsdom environment, so it
 * cannot be used here.
 */
const WEB_SRC = [join(process.cwd(), 'src'), join(process.cwd(), 'web', 'src')].find((p) => existsSync(p)) ?? '';

/** Modules under src/lib that web/ is allowed to import. questions.ts holds no answers. */
const ALLOWED_SERVER_IMPORTS = ['questions'];

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else if (/\.(ts|tsx|astro)$/.test(entry)) out.push(p);
	}
	return out;
}

/** Every import/re-export/dynamic-import specifier in a file. */
function importsOf(file: string): string[] {
	const src = readFileSync(file, 'utf8');
	return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const files = WEB_SRC ? walk(WEB_SRC) : [];

describe('the answer key never reaches the browser bundle', () => {
	it('actually found source files to check', () => {
		expect(WEB_SRC).not.toBe('');
		expect(files.length).toBeGreaterThan(0);
	});

	it('no file under web/src imports the answer key', () => {
		const offenders = files
			.filter((f) => importsOf(f).some((s) => s.toLowerCase().includes('answerkey')))
			.map((f) => f.replace(WEB_SRC, 'web/src/'));
		expect(offenders).toEqual([]);
	});

	it('only questions.ts may be imported from the server tree', () => {
		const offenders: string[] = [];
		for (const f of files) {
			for (const spec of importsOf(f)) {
				const m = spec.match(/(?:^|\/)src\/lib\/([A-Za-z0-9_.-]+?)(?:\.[tj]sx?)?$/);
				if (m && !ALLOWED_SERVER_IMPORTS.includes(m[1])) {
					offenders.push(`${f.replace(WEB_SRC, 'web/src/')} imports ${spec}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
