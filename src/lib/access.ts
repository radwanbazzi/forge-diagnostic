/**
 * Admin authentication for /api/admin/* (BACKEND_SPEC §1 US-3/US-4, PRD §9).
 *
 * Production: Cloudflare Access sits in front of the Worker and only forwards
 * authenticated requests, injecting a signed JWT in the `Cf-Access-Jwt-Assertion`
 * header. As defense-in-depth the Worker ALSO verifies that JWT here — signature
 * (against the team's JWKS), audience, issuer, and that the email is the founder's.
 *
 * Local dev: Cloudflare Access is not set up yet, so there is a header-based bypass
 * for testing. It is safe because it is DOUBLY gated:
 *   1. It only works when `DEV_ADMIN_SECRET` is set — that lives only in `.dev.vars`
 *      (gitignored) and is NEVER set as a production secret.
 *   2. It is force-disabled whenever `ACCESS_AUD` is set (i.e. whenever the app is
 *      configured for production Access).
 * So even if the secret ever leaked into production, the bypass would still be off.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types';

export interface AdminIdentity {
	email: string;
	via: 'access' | 'dev';
}

/** Verify a Cloudflare Access JWT. Key resolution is injected so it is unit-testable. */
export async function verifyAccessJwt(
	token: string,
	opts: { keys: JWTVerifyGetKey; aud: string; issuer: string; adminEmail: string },
): Promise<AdminIdentity | null> {
	try {
		const { payload } = await jwtVerify(token, opts.keys, { audience: opts.aud, issuer: opts.issuer });
		const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
		if (!email || email !== opts.adminEmail.toLowerCase()) return null;
		return { email, via: 'access' };
	} catch {
		return null; // bad signature / aud / issuer / expiry → not authenticated
	}
}

// One JWKS resolver per team domain, cached at module scope (reused across requests).
const jwksByDomain = new Map<string, JWTVerifyGetKey>();
function jwksFor(teamDomain: string): JWTVerifyGetKey {
	const domain = teamDomain.replace(/\/$/, '');
	let resolver = jwksByDomain.get(domain);
	if (!resolver) {
		resolver = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
		jwksByDomain.set(domain, resolver);
	}
	return resolver;
}

/**
 * The local-dev bypass is allowed ONLY in a non-production configuration:
 *   - `ACCESS_AUD` is NOT set (production sets it), AND
 *   - `DEV_ADMIN_SECRET` IS set (lives only in .dev.vars, never deployed).
 * Both must hold, so the bypass is provably impossible in production.
 */
export function devBypassAllowed(env: { ACCESS_AUD?: string; DEV_ADMIN_SECRET?: string }): boolean {
	return !env.ACCESS_AUD && !!env.DEV_ADMIN_SECRET;
}

/** Resolve a dev-bypass identity from request headers, or null (always null in production). */
export function checkDevBypass(
	env: { ACCESS_AUD?: string; DEV_ADMIN_SECRET?: string; ADMIN_EMAIL?: string },
	secretHeader: string | undefined,
	emailHeader: string | undefined,
): AdminIdentity | null {
	if (!devBypassAllowed(env) || !env.ADMIN_EMAIL) return null;
	if (secretHeader === env.DEV_ADMIN_SECRET && emailHeader && emailHeader.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()) {
		return { email: emailHeader.toLowerCase(), via: 'dev' };
	}
	return null;
}

export type AuthResult = { ok: true; identity: AdminIdentity } | { ok: false };

/** Resolve the authenticated admin for a request, or `{ ok: false }`. */
export async function authenticateAdmin(c: Context<HonoEnv>): Promise<AuthResult> {
	const env = c.env;
	const adminEmail = env.ADMIN_EMAIL;
	if (!adminEmail) return { ok: false }; // misconfigured → deny (never open by default)

	// 1) Production: verify the Cloudflare Access JWT (defense-in-depth).
	const token = c.req.header('Cf-Access-Jwt-Assertion');
	if (env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN && token) {
		const identity = await verifyAccessJwt(token, {
			keys: jwksFor(env.ACCESS_TEAM_DOMAIN),
			aud: env.ACCESS_AUD,
			issuer: env.ACCESS_TEAM_DOMAIN.replace(/\/$/, ''),
			adminEmail,
		});
		if (identity) return { ok: true, identity };
	}

	// 2) Local-dev bypass — provably off in production (see devBypassAllowed).
	const dev = checkDevBypass(env, c.req.header('X-Dev-Access-Secret'), c.req.header('X-Dev-Access-Email'));
	if (dev) return { ok: true, identity: dev };

	return { ok: false };
}

/** Hono middleware for admin routes: 401 unless the request is an authenticated founder. */
export function requireAdmin(): MiddlewareHandler<HonoEnv> {
	return async (c, next) => {
		const auth = await authenticateAdmin(c);
		if (!auth.ok) return c.json({ error: 'unauthorized' }, 401);
		await next();
	};
}
