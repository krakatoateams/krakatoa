/**
 * Owner check for user post mutations. Pure — no Supabase.
 * Wrong-owner stays 403 (the route already fetched the row).
 */

export function postOwnerDenied(
  existingProfileId: string | null | undefined,
  sessionProfileId: string,
): { status: 403; error: string } | null {
  if (existingProfileId !== sessionProfileId) {
    return { status: 403, error: "Forbidden." };
  }
  return null;
}

/** POST /api/posts must not insert a scheduled row without a session. */
export function schedulePostCreateDenied(hasSession: boolean): {
  status: 401;
  error: string;
} | null {
  if (!hasSession) {
    return { status: 401, error: "Not authenticated." };
  }
  return null;
}

/** Mirrors the publisher cron stale-claim window. */
export const POST_CLAIM_STALE_MS = 10 * 60 * 1000;

export function isActivePublishClaim(
  publishStartedAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!publishStartedAt) return false;
  const claimedAt = new Date(publishStartedAt).getTime();
  return Number.isFinite(claimedAt) && nowMs - claimedAt < POST_CLAIM_STALE_MS;
}

/**
 * Whether PATCH's UPDATE would still apply against the row's current claim
 * and terminal status. The route must encode this in the UPDATE filters so a
 * concurrent cron claim cannot lose to a later cancel/edit/retry.
 */
export function postPatchUpdateApplies(
  row: { status: string; publish_started_at?: string | null },
  nowMs: number,
): boolean {
  if (row.status === "published") return false;
  if (isActivePublishClaim(row.publish_started_at, nowMs)) return false;
  return true;
}

export function postPatchLostPublishRace(
  updated: unknown | null,
): { status: 409; error: string } | null {
  if (!updated) {
    return {
      status: 409,
      error: "This post is being published right now. Try again shortly.",
    };
  }
  return null;
}
