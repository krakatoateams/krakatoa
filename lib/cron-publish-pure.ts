/**
 * Publisher-cron decisions that must stay testable without Next.js or Supabase.
 * Classifiers live here so last_error text and retry policy stay aligned with
 * the real provider error strings.
 */

import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/** Log-safe token summary — never include access or refresh token material. */
export function cronTokenLogSafe(token: {
  refresh_token?: string | null;
}): { has_refresh_token: boolean } {
  return { has_refresh_token: Boolean(token.refresh_token) };
}

/** Processing log — keep path, strip signed-URL query tokens. */
export function cronProcessingLogSafe(post: {
  id: unknown;
  title: unknown;
  platform: unknown;
  user_id: unknown;
  scheduled_time: unknown;
  video_url?: string | null;
}): {
  id: unknown;
  title: unknown;
  platform: unknown;
  user_id: unknown;
  scheduled_time: unknown;
  video_url?: string | null;
} {
  return {
    id: post.id,
    title: post.title,
    platform: post.platform,
    user_id: post.user_id,
    scheduled_time: post.scheduled_time,
    video_url: post.video_url ? redactPublishMediaRef(post.video_url) : post.video_url,
  };
}

/**
 * Classify a YouTube (or generic) upload failure. Permanent failures will not
 * self-heal on retry and may waste scarce YouTube quota.
 */
export function isPermanentFailure(err: unknown, message: string): boolean {
  const m = message.toLowerCase();
  if (/re-?authori|refresh token|invalid_grant|sign in again|token for user|access token from google/.test(m)) {
    return true;
  }
  if (/quota|dailylimitexceeded|quotaexceeded/.test(m)) {
    return true;
  }
  if (/video file no longer exists in storage|could not fetch video from storage/.test(m)) {
    return true;
  }
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return true;
  return false;
}

/**
 * Same intent as isPermanentFailure, for TikTok's error shapes.
 * Daily-cap (spam_risk_too_many_posts) is handled before this runs.
 */
export function isTikTokPermanentFailure(err: unknown, message: string): boolean {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "spam_risk_user_banned_from_posting"
  ) {
    return true;
  }
  const m = message.toLowerCase();
  if (/re-?authori|refresh token|reconnect|token for user|token request failed/.test(m)) {
    return true;
  }
  if (/branded content cannot be posted|self_only/.test(m)) {
    return true;
  }
  if (/video file no longer exists in storage|could not fetch video from storage/.test(m)) {
    return true;
  }
  // Photo posts: a domain/URL-prefix verification problem can't self-heal.
  // Live throw text is "not a recognized user photo storage path" (lib/tiktok.ts).
  if (
    /url_ownership_unverified|not a recognized user photo storage path|not a recognized storage url/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`cron-publish self-check: ${message}`);
}

export function cronPublishSelfCheck(): void {
  assert(
    isTikTokPermanentFailure(
      null,
      "Photo URL is not a recognized user photo storage path — cannot proxy for TikTok: user/photos/x.png",
    ),
    "unrecognized TikTok photo path must be a permanent failure",
  );
  assert(
    isTikTokPermanentFailure(null, "url_ownership_unverified"),
    "TikTok url_ownership_unverified must stay permanent",
  );
  assert(
    isTikTokPermanentFailure({ code: "spam_risk_user_banned_from_posting" }, "banned"),
    "TikTok account ban must be permanent",
  );
  assert(
    !isTikTokPermanentFailure(null, "network timeout"),
    "generic TikTok network errors must stay transient",
  );
  assert(
    isPermanentFailure({ response: { status: 403 } }, "quotaExceeded"),
    "YouTube quota must be permanent",
  );
  assert(
    isPermanentFailure(null, "Video file no longer exists in storage — it was deleted or swept before publishing."),
    "missing video must be permanent",
  );

  const logged = cronTokenLogSafe({
    refresh_token: "secret-refresh-token-value",
  });
  assert(logged.has_refresh_token === true, "refresh presence must be loggable");
  assert(
    !JSON.stringify(logged).includes("secret-refresh-token-value"),
    "cron token logs must not include refresh token material",
  );

  const processing = cronProcessingLogSafe({
    id: "p1",
    title: "clip",
    platform: "youtube",
    user_id: "u1",
    scheduled_time: "2026-09-12T00:00:00.000Z",
    video_url:
      "https://example.supabase.co/storage/v1/object/sign/krakatoa/u1/videos/clip.mp4?token=secret-jwt&expires=999",
  });
  assert(
    !JSON.stringify(processing).includes("secret-jwt") &&
      !JSON.stringify(processing).includes("token="),
    "cron processing logs must not include signed URL tokens",
  );
  assert(
    String(processing.video_url).includes("/u1/videos/clip.mp4"),
    "cron processing logs must keep the object path",
  );
}

if (require.main === module) {
  cronPublishSelfCheck();
  console.log("cron-publish self-check passed");
}
