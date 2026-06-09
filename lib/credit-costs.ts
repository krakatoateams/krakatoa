/**
 * Krakatoa credit cost constants.
 *
 * Pricing Config v2.2 NOTE: generation pricing is NO LONGER driven by these
 * constants. The runtime resolver (lib/pricing-resolver.ts) prices every
 * generation from provider USD cost via the v2 `pricing_configs` rows, falling
 * back to the typed built-in v2 defaults in lib/pricing-defaults.ts. The legacy
 * generation constants below (VIDEO_CREDITS_PER_SECOND, STORYBOARD_IMAGE_CREDITS,
 * STORYBOARD_VIDEO_CREDITS, PRODUCT_PHOTO_CREDITS) are retained ONLY for:
 *   - the shared video rounding helper (roundVideoCredits) default rate, and
 *   - the admin reset-to-default values of the soft-deprecated legacy rows.
 * They are NOT a runtime pricing fallback anymore (no undercharging 2 cr/sec).
 *
 * INITIAL_DUMMY_CREDITS is different: it is a platform credit GRANT (not a
 * generation provider-cost price) and remains authoritative for the dummy phase.
 *
 * Billing-truth model (unchanged):
 *   - credit_transactions = billing source of truth (ledger).
 *   - credit_wallets.balance = fast-read cache kept in sync by the RPC.
 *   - jobs.cost_credits / assets.cost_credits are display snapshots only.
 *   - usage_events are analytics only and never affect a balance.
 */

/** Initial dummy bonus granted to every existing/future profile. */
export const INITIAL_DUMMY_CREDITS = 500;

/** @deprecated v2.2 — legacy fallback rate only; runtime uses provider-cost v2 defaults. */
export const VIDEO_CREDITS_PER_SECOND = 2;

/** @deprecated v2.2 — reset-default for the deprecated `storyboard_image` legacy row only. */
export const STORYBOARD_IMAGE_CREDITS = 2;

/** @deprecated v2.2 — reset-default for the deprecated `storyboard_video` legacy row only. */
export const STORYBOARD_VIDEO_CREDITS = 30;

/** @deprecated v2.2 — reset-default for the deprecated `product_photo` legacy row only. */
export const PRODUCT_PHOTO_CREDITS = 5;

/**
 * Round a video duration to integer credits at an arbitrary per-second rate.
 *
 * Shared by the DB-backed pricing resolver (server) and the pricing context
 * (client) so on-screen labels and billing use identical math. Same rounding
 * rules as the historical `estimateVideoCredits`:
 *   - `Math.ceil` so a request never rounds down to a free generation.
 *   - Floor of 1 credit so video is never zero-cost (even if rate is 0 or a
 *     tiny/malformed duration slips through).
 *   - NaN / negative inputs collapse to the 1-credit floor.
 */
export function roundVideoCredits(durationSec: number, ratePerSecond: number): number {
  const safeDuration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const safeRate = Number.isFinite(ratePerSecond) ? Math.max(0, ratePerSecond) : 0;
  const credits = Math.ceil(safeDuration * safeRate);
  return Math.max(1, credits);
}

export function estimateVideoCredits(durationSec: number): number {
  return roundVideoCredits(durationSec, VIDEO_CREDITS_PER_SECOND);
}

/** ReelsGen/Seedance cost: total video duration × VIDEO_CREDITS_PER_SECOND. */
export function estimateSeedanceCredits(params: {
  sceneCount: number;
  durationPerScene: number;
}): number {
  return estimateVideoCredits(params.sceneCount * params.durationPerScene);
}

/**
 * Veo cost. Caller passes the total clip duration in seconds:
 *   - single mode → the one-clip duration (4/6/8 → 8/12/16 credits)
 *   - perScene mode → sceneCount × durationPerScene
 */
export function estimateVeoCredits(params: { durationSec: number }): number {
  return estimateVideoCredits(params.durationSec);
}

export function estimateStoryboardImageCredits(): number {
  return STORYBOARD_IMAGE_CREDITS;
}

export function estimateStoryboardVideoCredits(): number {
  return STORYBOARD_VIDEO_CREDITS;
}

export function estimateProductPhotoCredits(): number {
  return PRODUCT_PHOTO_CREDITS;
}
