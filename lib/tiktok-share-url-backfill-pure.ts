/**
 * Decisions for backfilling `posts.tiktok_share_url` after publish (#486).
 *
 * TikTok only returns `publicaly_available_post_id` once a public post has
 * passed moderation, which usually lands after PUBLISH_COMPLETE — so the
 * publisher cron's single check at publish time almost always misses it.
 * The cron re-checks recently published public posts on a slow cadence
 * instead. Split out from lib/tiktok-share-url-backfill.ts (network + DB)
 * so the cadence and window get a real unit test.
 */

/** Re-check cadence: only on ticks whose UTC minute is a multiple of this. */
export const SHARE_URL_BACKFILL_EVERY_MINUTES = 10;

/**
 * How far back (by scheduled_time) a published post is still re-checked.
 * 48h rather than 24h: a TikTok daily-cap backoff can publish a post up to
 * ~24h after its scheduled_time, and moderation can take hours after that.
 */
export const SHARE_URL_BACKFILL_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Posts checked per backfill tick — keeps the cron well inside maxDuration. */
export const SHARE_URL_BACKFILL_BATCH = 5;

export function shouldRunShareUrlBackfill(nowMs: number): boolean {
  return new Date(nowMs).getUTCMinutes() % SHARE_URL_BACKFILL_EVERY_MINUTES === 0;
}

export function shareUrlBackfillWindowStart(nowMs: number): string {
  return new Date(nowMs - SHARE_URL_BACKFILL_WINDOW_MS).toISOString();
}

/** Stored token is usable without a refresh if it outlives a 2-minute margin. */
export function tiktokAccessTokenStillValid(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs - nowMs > 2 * 60 * 1000;
}

export function tiktokShareUrlBackfillSelfCheck(): void {
  const at = (iso: string) => Date.parse(iso);

  if (!shouldRunShareUrlBackfill(at("2026-11-02T08:10:30Z"))) {
    throw new Error("backfill must run on a :10 tick");
  }
  if (shouldRunShareUrlBackfill(at("2026-11-02T08:11:00Z"))) {
    throw new Error("backfill must not run on every tick");
  }

  const now = at("2026-11-03T12:00:00Z");
  if (shareUrlBackfillWindowStart(now) !== "2026-11-01T12:00:00.000Z") {
    throw new Error("window must reach back 48h");
  }

  if (!tiktokAccessTokenStillValid("2026-11-03T13:00:00Z", now)) {
    throw new Error("a token valid for another hour must be reused");
  }
  if (tiktokAccessTokenStillValid("2026-11-03T12:01:00Z", now)) {
    throw new Error("a token about to expire must be refreshed");
  }
  if (tiktokAccessTokenStillValid(null, now) || tiktokAccessTokenStillValid("not-a-date", now)) {
    throw new Error("a missing or unreadable expiry must be refreshed");
  }
}

if (require.main === module) {
  tiktokShareUrlBackfillSelfCheck();
  console.log("tiktokShareUrlBackfillSelfCheck: ok");
}
