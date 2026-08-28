import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { checkDevBypass, devBypassAllowed } from '../src/lib/access';
import { buildResultPayload } from '../src/lib/resultCopy';
import { isValidComputed, score } from '../src/lib/scoring';
import { RAMI } from './fixtures';

describe('security headers (B7)', () => {
	it('sets X-Content-Type-Options: nosniff on responses', async () => {
		const res = await SELF.fetch('https://x/api/health');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});
});

describe('request body size limit (B7)', () => {
	it('rejects an oversized body with 413, never 500', async () => {
		const huge = 'x'.repeat(40 * 1024); // > 32 KB
		const res = await SELF.fetch('https://x/api/diagnostic/submit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ session_id: 'big', blob: huge }),
		});
		expect(res.status).toBe(413);
		expect(res.status).not.toBe(500);
	});
});

describe('public POST rate limiting (B7)', () => {
	it('drops a submit flood with 429', async () => {
		let got429 = false;
		for (let i = 0; i < 35; i++) {
			// '{}' passes the rate gate, then fails validation fast (no scoring) until the flood trips 429.
			const res = await SELF.fetch('https://x/api/diagnostic/submit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}',
			});
			if (res.status === 429) {
				got429 = true;
				break;
			}
		}
		expect(got429).toBe(true);
	});
});

describe('admin dev-bypass is provably off in production (US-3/US-4 security)', () => {
	it('devBypassAllowed: on in dev config, OFF when ACCESS_AUD (production) is set', () => {
		expect(devBypassAllowed({ DEV_ADMIN_SECRET: 'x' })).toBe(true);
		expect(devBypassAllowed({ ACCESS_AUD: 'aud', DEV_ADMIN_SECRET: 'x' })).toBe(false);
		expect(devBypassAllowed({})).toBe(false);
	});

	it('checkDevBypass authenticates in dev but never in production', () => {
		const env = { DEV_ADMIN_SECRET: 'x', ADMIN_EMAIL: 'a@b.com' };
		expect(checkDevBypass(env, 'x', 'a@b.com')).toEqual({ email: 'a@b.com', via: 'dev' });
		expect(checkDevBypass(env, 'wrong', 'a@b.com')).toBeNull();
		// Production: ACCESS_AUD set → bypass off even with the correct dev creds.
		expect(checkDevBypass({ ...env, ACCESS_AUD: 'aud' }, 'x', 'a@b.com')).toBeNull();
	});
});

describe('fail-closed guards (US-1/US-2)', () => {
	it('isValidComputed rejects an impossible computed state (F1.8)', () => {
		const good = score({ answers: RAMI.answers, contact: { whatsapp: RAMI.contact.whatsapp, school: null } });
		expect(isValidComputed(good)).toBe(true);
		expect(isValidComputed({ ...good, overall_band: 'not-a-band' })).toBe(false);
		expect(isValidComputed({ ...good, current_mid: Number.NaN })).toBe(false);
	});

	it('result_payload has no wa.me link (and no "undefined") when WHATSAPP_NUMBER is missing (F2.1)', () => {
		const computed = score({ answers: RAMI.answers, contact: { whatsapp: RAMI.contact.whatsapp, school: null } });
		const payload = buildResultPayload(computed, RAMI.answers, RAMI.contact.first_name, {}); // no number configured
		expect(payload.cta.whatsapp_url).toBeNull();
		expect(JSON.stringify(payload)).not.toContain('undefined');
	});
});
