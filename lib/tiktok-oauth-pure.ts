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
}

if (require.main === module) {
  tiktokOAuthSelfCheck();
  console.log("tiktokOAuthSelfCheck: ok");
}
