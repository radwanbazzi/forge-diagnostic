import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyAccessJwt } from '../src/lib/access';

// Unit-tests the Cloudflare Access JWT verification with a locally-generated key +
// JWKS (no network), so the real signature/aud/issuer/expiry checks are proven.

const AUD = 'test-access-aud';
const ISS = 'https://forge.cloudflareaccess.com';
const ADMIN = 'founder@example.com';

async function setup() {
	const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
	const jwk = await exportJWK(publicKey);
	jwk.kid = 'kid1';
	jwk.alg = 'RS256';
	jwk.use = 'sig';
	const keys = createLocalJWKSet({ keys: [jwk] });
	return { privateKey, keys };
}

async function makeToken(
	privateKey: CryptoKey,
	opts: { email?: string; aud?: string; iss?: string; expSeconds?: number } = {},
): Promise<string> {
	const b = new SignJWT(opts.email ? { email: opts.email } : {})
		.setProtectedHeader({ alg: 'RS256', kid: 'kid1' })
		.setAudience(opts.aud ?? AUD)
		.setIssuer(opts.iss ?? ISS)
		.setIssuedAt();
	b.setExpirationTime(opts.expSeconds ?? '1h');
	return b.sign(privateKey);
}

describe('verifyAccessJwt', () => {
	it('accepts a valid token for the admin email', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, { email: ADMIN });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toEqual({ email: ADMIN, via: 'access' });
	});

	it('rejects a token for a different email', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, { email: 'intruder@example.com' });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});

	it('rejects a token with no email claim', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, {});
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});

	it('rejects a wrong audience', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, { email: ADMIN, aud: 'some-other-aud' });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});

	it('rejects a wrong issuer', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, { email: ADMIN, iss: 'https://evil.example.com' });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});

	it('rejects an expired token', async () => {
		const { privateKey, keys } = await setup();
		const token = await makeToken(privateKey, { email: ADMIN, expSeconds: Math.floor(Date.now() / 1000) - 60 });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});

	it('rejects a token signed by a different key', async () => {
		const { keys } = await setup();
		const attacker = await setup();
		const token = await makeToken(attacker.privateKey, { email: ADMIN });
		expect(await verifyAccessJwt(token, { keys, aud: AUD, issuer: ISS, adminEmail: ADMIN })).toBeNull();
	});
});
