import { hasAnyJobs } from "@/lib/jobs-db";
import { hasCreditTransaction } from "@/lib/credits-db";
import { getWelcomeBonusSettings } from "@/lib/welcome-bonus-settings-db";
import { isWelcomeVideoOfferEligible } from "@/lib/welcome-video-offer-pure";

/**
 * Idempotency key for the on-demand welcome-video grant (see migration 089
 * and POST /api/welcome-video-offer/claim). Deliberately distinct from the
 * old auto-grant trigger's 'seed:welcome_bonus:{id}' key so the two can
 * never collide.
 */
export function welcomeVideoClaimIdempotencyKey(profileId: string): string {
  return `bonus:welcome_video_claim:${profileId}`;
}

/** Pre-migration-089 automatic welcome grant key. */
export function legacyWelcomeBonusIdempotencyKey(profileId: string): string {
  return `seed:welcome_bonus:${profileId}`;
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
 * - the configured grant amount is greater than zero
 * - this profile has neither claimed it nor received the legacy pre-089
 *   automatic welcome grant (checked by both stable idempotency keys, not
 *   wallet balance)
 * - this profile has never created a single job — a safety net so an older
 *   pre-existing account doesn't see "claim your free video" just because
 *   an admin turns the offer on later
 */
export async function getWelcomeVideoOfferEligibility(
  profileId: string
): Promise<WelcomeVideoOfferEligibility> {
  const [
    { enabled, creditAmount },
    hasJobs,
    hasClaimed,
    hasLegacyGrant,
  ] = await Promise.all([
    getWelcomeBonusSettings(),
    hasAnyJobs(profileId),
    hasCreditTransaction(profileId, welcomeVideoClaimIdempotencyKey(profileId)),
    hasCreditTransaction(profileId, legacyWelcomeBonusIdempotencyKey(profileId)),
  ]);

  return {
    eligible: isWelcomeVideoOfferEligible({
      enabled,
      creditAmount,
      hasJobs,
      hasClaimed: hasClaimed || hasLegacyGrant,
    }),
    creditAmount,
  };
}
