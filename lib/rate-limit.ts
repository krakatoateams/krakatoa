/**
 * In-memory rate limiter keyed by IP address.
 *
 * LIMITATION: Vercel serverless functions do not share memory across instances.
 * This limiter is per-instance only — concurrent cold starts on separate instances
 * each get their own fresh store, so the effective limit is multiplied by however
 * many instances are running. This is acceptable as a first line of defense for
 * low-traffic internal use, but should be replaced with Upstash Redis (or similar
 * globally consistent store) before the app has meaningful public traffic.
 * See: https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
 */

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

function pruneExpired(): void {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (now >= entry.resetAt) store.delete(key);
  });
}

/**
 * Returns true if the request should be allowed, false if the IP has exceeded
 * the limit. Default: 10 requests per IP per 60-second window.
 *
 * Expired entries are pruned lazily whenever a new window starts for any IP,
 * keeping memory bounded without a background timer.
 */
export function checkRateLimit(
  ip: string,
  limit = 10,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now >= entry.resetAt) {
    // New or expired window — prune stale entries then open a fresh one.
    pruneExpired();
    store.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}
