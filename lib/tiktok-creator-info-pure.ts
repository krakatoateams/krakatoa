/**
 * Classifies TikTok's Query Creator Info error codes into how this app
 * should react. Split out from lib/tiktok.ts (which does real network I/O)
 * so this mapping — the part of the TikTok resubmission fix hardest to
 * reproduce against TikTok's real API on demand — gets a real unit test
 * instead of only a manual click-through.
 *
 * `spam_risk_user_banned_from_posting` has no time dimension in TikTok's own
 * docs, so it's treated as a permanent block. `spam_risk_too_many_posts` is
 * explicitly a daily/rolling cap, so it's treated as transient — callers
 * (app/api/cron/route.ts) give it a bounded wall-clock auto-retry rather
 * than failing immediately, which matters because Kelolako's own core use
 * case (scheduling many reels/day) makes hitting a daily cap a plausible
 * routine occurrence, not a rare edge case.
 */
export type TikTokCreatorInfoErrorSeverity = "blocked" | "rate_limited" | "unknown";

export interface TikTokCreatorInfoClassification {
  severity: TikTokCreatorInfoErrorSeverity;
  message: string;
}

const BLOCKED_MESSAGE =
  "This TikTok account is banned from posting. Reconnect a different account or resolve this in the TikTok app before scheduling more TikTok posts.";

const RATE_LIMITED_MESSAGE =
  "TikTok's daily post cap for this account is reached right now — this will keep retrying automatically for up to 24 hours before you'd need to step in.";

const UNKNOWN_MESSAGE = "TikTok couldn't confirm this account can post right now.";

export function classifyTikTokCreatorInfoError(code: string): TikTokCreatorInfoClassification {
  switch (code) {
    case "spam_risk_user_banned_from_posting":
      return { severity: "blocked", message: BLOCKED_MESSAGE };
    case "spam_risk_too_many_posts":
      return { severity: "rate_limited", message: RATE_LIMITED_MESSAGE };
    default:
      return { severity: "unknown", message: UNKNOWN_MESSAGE };
  }
}

export function tiktokCreatorInfoClassifierSelfCheck(): void {
  const blocked = classifyTikTokCreatorInfoError("spam_risk_user_banned_from_posting");
  if (blocked.severity !== "blocked") {
    throw new Error("spam_risk_user_banned_from_posting must classify as blocked");
  }
  if (blocked.message !== BLOCKED_MESSAGE) {
    throw new Error("blocked message must be the friendly ban text, not TikTok's raw code");
  }

  const rateLimited = classifyTikTokCreatorInfoError("spam_risk_too_many_posts");
  if (rateLimited.severity !== "rate_limited") {
    throw new Error("spam_risk_too_many_posts must classify as rate_limited");
  }
  if (rateLimited.message !== RATE_LIMITED_MESSAGE) {
    throw new Error("rate_limited message must be the friendly daily-cap text, not TikTok's raw code");
  }
  if (!/24 hours/.test(rateLimited.message)) {
    throw new Error("rate_limited message must honestly describe the bounded 24h auto-retry, not an unbounded promise");
  }

  const unrecognized = classifyTikTokCreatorInfoError("some_future_tiktok_code");
  if (unrecognized.severity !== "unknown") {
    throw new Error("an unrecognized code must classify as unknown, not silently as blocked or rate_limited");
  }

  const reachedActiveUserCap = classifyTikTokCreatorInfoError("reached_active_user_cap");
  if (reachedActiveUserCap.severity !== "unknown") {
    throw new Error("reached_active_user_cap is this app's own client-wide quota, not a per-creator signal — must classify as unknown, not blocked or rate_limited");
  }
}

if (require.main === module) {
  tiktokCreatorInfoClassifierSelfCheck();
  console.log("tiktokCreatorInfoClassifierSelfCheck: ok");
}
