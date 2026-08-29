import { defineConfig } from 'astro/config';

// Static, SEO-friendly output (PRD §5/§13). Builds to ./dist (web/dist), which the
// Worker serves as static assets alongside /api/* (see wrangler.jsonc "assets").
export default defineConfig({
	output: 'static',
});
