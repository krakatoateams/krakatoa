import { hasAnyJobs } from "@/lib/jobs-db";
import { hasCreditTransaction } from "@/lib/credits-db";
import { getWelcomeBonusSettings } from "@/lib/welcome-bonus-settings-db";

/**
 * Idempotency key for the on-demand welcome-video grant (see migration 089
 * and POST /api/welcome-video-offer/claim). Deliberately distinct from the
 * old auto-grant trigger's 'seed:welcome_bonus:{id}' key so the two can
 * never collide.
 */
export function welcomeVideoClaimIdempotencyKey(profileId: string): string {
  return `bonus:welcome_video_claim:${profileId}`;
}

export type WelcomeVideoOfferEligibility = {
  eligible: boolean;
  creditAmount: number;
};

/**
 * Shared eligibility check used by both GET /api/welcome-video-offer (read)
 * and POST /api/welcome-video-offer/claim (re-validated before granting).
 *
 * Eligible requires ALL of:
 * - the admin-configured welcome bonus is enabled (now read as "is the
 *   claim offer on", not "auto-grant on signup" — see migration 089)
 * - this profile has never claimed it before (checked via the claim's own
 *   idempotency key, NOT wallet balance — balance is deliberately 0 before
 *   claiming under the on-demand model, so a balance check would have
 *   backwards logic here)
 * - this profile has never created a single job — a safety net so an older
 *   pre-existing account doesn't see "claim your free video" just because
 *   an admin turns the offer on later
 */
export async function getWelcomeVideoOfferEligibility(
  profileId: string
): Promise<WelcomeVideoOfferEligibility> {
  const [{ enabled, creditAmount }, hasJobs, hasClaimed] = await Promise.all([
    getWelcomeBonusSettings(),
    hasAnyJobs(profileId),
    hasCreditTransaction(profileId, welcomeVideoClaimIdempotencyKey(profileId)),
  ]);

  return {
    eligible: enabled && !hasJobs && !hasClaimed,
    creditAmount,
  };
}
