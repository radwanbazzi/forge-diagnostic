import { defineConfig } from 'vitest/config';

// Component tests for the diagnostic flow. jsdom + Testing Library, JSX via esbuild's
// automatic runtime so no extra Babel/plugin dependency is needed. CSS imports in the
// components are ignored (css:false) — these tests assert behaviour, not styling.
export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./test/setup.ts'],
		include: ['test/**/*.test.{ts,tsx}'],
		css: false,
		// Threads pool, one worker: the default forks pool times out spawning workers on
		// Windows paths containing spaces (this repo lives under "Radwan Bazzi").
		pool: 'threads',
		fileParallelism: false,
	},
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: 'react',
	},
});
