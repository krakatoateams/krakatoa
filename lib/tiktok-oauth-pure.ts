/**
 * Pure TikTok OAuth / token-lifecycle decisions. Split from the connect and
 * creator-info routes so rotating-refresh persist can be tested without
 * mocking TikTok or Supabase.
 *
 * TikTok invalidates the old refresh_token on every refresh (lib/tiktok.ts).
 * After a successful refresh the new tokens MUST be persisted before any
 * success response — Decision 5 in openspec/changes/connect-tiktok/design.md
 * and Decision 3 in openspec/changes/tiktok-publish/design.md. The cron
 * publish path already fails closed; creator-info must match.
 */

import { readFileSync } from "node:fs";

export const TIKTOK_RECONNECT_MESSAGE =
  "TikTok connection needs to be re-authorized.";

export interface TikTokRefreshPersistDenied {
  status: 409;
  error: string;
}

/**
 * After TikTok has already rotated the refresh token, a failed
 * `platform_tokens` upsert leaves the stored token dead. Fail closed so the
 * caller cannot return creator-info success and hide a broken connection.
 */
export function tiktokRotatedRefreshPersistDenied(
  upsertError: { message?: string } | null | undefined,
): TikTokRefreshPersistDenied | null {
  if (!upsertError) return null;
  return { status: 409, error: TIKTOK_RECONNECT_MESSAGE };
}

export type TikTokRefreshClaim = {
  claimed: boolean;
  reason?: "held" | "missing";
};

/** Winner refreshes; loser must re-read the persisted row, never refresh again. */
export function tiktokRefreshAfterClaim(
  claim: TikTokRefreshClaim,
): "refresh" | "reread" | "missing" {
  if (!claim.claimed && claim.reason === "missing") return "missing";
  return claim.claimed ? "refresh" : "reread";
}

export function tiktokLoserAfterReread(input: {
  claimedRefreshToken: string;
  rereadRefreshToken: string | null | undefined;
}): "use_persisted" | "reread_again" {
  if (input.rereadRefreshToken && input.rereadRefreshToken !== input.claimedRefreshToken) {
    return "use_persisted";
  }
  return "reread_again";
}

function assertTikTokRefreshLockedInSource(source: string, label: string): void {
  if (!source.includes("refreshTikTokTokensLocked")) {
    throw new Error(`${label} must take the shared TikTok refresh lock before rotating tokens`);
  }
  if (/refreshAccessToken\s*\(/.test(source)) {
    throw new Error(
      `${label} must not call refreshAccessToken directly — only the locked helper may rotate`,
    );
  }
}

export function tiktokOAuthSelfCheck(): void {
  const persistFailed = tiktokRotatedRefreshPersistDenied({ message: "upsert failed" });
  if (persistFailed?.status !== 409) {
    throw new Error(
      "a failed persist after TikTok refresh must fail closed with 409, not proceed",
    );
  }
  if (persistFailed.error !== TIKTOK_RECONNECT_MESSAGE) {
    throw new Error("persist failure after refresh must ask the user to reconnect");
  }

  if (tiktokRotatedRefreshPersistDenied(null) !== null) {
    throw new Error("a successful persist after refresh must proceed");
  }
  if (tiktokRotatedRefreshPersistDenied(undefined) !== null) {
    throw new Error("an absent persist error after refresh must proceed");
  }

  const lock = { holder: null as string | null };
  const claim = (id: string): TikTokRefreshClaim => {
    if (lock.holder) return { claimed: false, reason: "held" };
    lock.holder = id;
    return { claimed: true };
  };
  if (tiktokRefreshAfterClaim(claim("creator-info")) !== "refresh") {
    throw new Error("the lock winner must be the only caller that refreshes");
  }
  if (tiktokRefreshAfterClaim(claim("cron")) !== "reread") {
    throw new Error("the lock loser must re-read, not refresh with the stale token");
  }
  if (tiktokRefreshAfterClaim({ claimed: false, reason: "missing" }) !== "missing") {
    throw new Error("a missing TikTok row must not invent a refresh");
  }

  if (
    tiktokLoserAfterReread({
      claimedRefreshToken: "old-refresh",
      rereadRefreshToken: "rotated-refresh",
    }) !== "use_persisted"
  ) {
    throw new Error("after the winner persists, the loser must use the new refresh_token");
  }
  if (
    tiktokLoserAfterReread({
      claimedRefreshToken: "old-refresh",
      rereadRefreshToken: "old-refresh",
    }) !== "reread_again"
  ) {
    throw new Error("if the winner has not persisted yet, the loser must wait and re-read");
  }

  const creatorInfo = readFileSync(
    new URL("../app/api/connections/tiktok/creator-info/route.ts", import.meta.url),
    "utf8",
  );
  const cron = readFileSync(new URL("../app/api/cron/route.ts", import.meta.url), "utf8");
  assertTikTokRefreshLockedInSource(creatorInfo, "tiktok creator-info");
  assertTikTokRefreshLockedInSource(cron, "publisher cron TikTok branch");
}

if (require.main === module) {
  tiktokOAuthSelfCheck();
  console.log("tiktokOAuthSelfCheck: ok");
}
