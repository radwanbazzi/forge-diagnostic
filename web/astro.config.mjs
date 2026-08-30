import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static, SEO-friendly output (PRD §5/§13). Builds to ./dist (web/dist), which the
// Worker serves as static assets alongside /api/* (see wrangler.jsonc "assets").
//
// F-M1: the interactive diagnostic is a React island (client-side), so we enable the
// React integration. The island imports the shared, browser-safe question config from
// the repo root (src/lib/questions.ts) — the single source of truth for question text —
// so we widen Vite's dev file-serving allow-list to the repo root ('..').
export default defineConfig({
	output: 'static',
	integrations: [react()],
	vite: {
		server: {
			fs: {
				allow: ['..'],
			},
		},
	},
});
