/**
 * A tiny in-memory fixed-window rate limiter for the public event beacon (US-7 F7.1).
 *
 * It is per-isolate and dependency-free (no KV, no DB) — a lightweight guard that drops
 * an obvious flood hitting the same isolate without adding load to the hot path. It is
 * best-effort, not globally exact; B7 can add distributed limiting (Durable Object or
 * Cloudflare's Rate Limiting binding) if ever needed at scale.
 */
interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Returns true if the call is allowed, false if the key is over its limit for the window. */
export function checkRateLimit(key: string, now: number, limit: number, windowMs: number): boolean {
	const bucket = buckets.get(key);
	if (!bucket || now >= bucket.resetAt) {
		// Occasionally prune expired entries so the map cannot grow unbounded.
		if (buckets.size > 5000) {
			for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
		}
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}
	if (bucket.count >= limit) return false;
	bucket.count++;
	return true;
}

/** Test helper — clears all buckets. */
export function _resetRateLimits(): void {
	buckets.clear();
}
