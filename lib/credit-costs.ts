/**
 * Krakatoa credit cost configuration.
 *
 * Single source of truth for every credit price used by the generation routes.
 * Pricing is rough/dummy values for the internal testing phase and is expected
 * to change once real provider economics are measured — when that happens the
 * constants here are the only thing to edit.
 *
 * Billing-truth model (unchanged):
 *   - credit_transactions = billing source of truth (ledger).
 *   - credit_wallets.balance = fast-read cache kept in sync by the RPC.
 *   - jobs.cost_credits / assets.cost_credits are display snapshots only.
 *   - usage_events are analytics only and never affect a balance.
 */

/** Initial dummy bonus granted to every existing/future profile. */
export const INITIAL_DUMMY_CREDITS = 500;

/** Per-second rate for any text-to-video generation in scope (Seedance, Veo). */
export const VIDEO_CREDITS_PER_SECOND = 2;

/** Fixed cost for one storyboard image generation (gpt-image-2). */
export const STORYBOARD_IMAGE_CREDITS = 2;

/** Fixed cost for one storyboard-to-video generation (Seedance 15s clip). */
export const STORYBOARD_VIDEO_CREDITS = 30;

/** Fixed cost for one Product Photo generation (Nano Banana). */
export const PRODUCT_PHOTO_CREDITS = 5;

/**
 * Convert a video duration in seconds to integer credits at
 * VIDEO_CREDITS_PER_SECOND.
 *
 * - `Math.ceil` so a request never rounds down to a free generation.
 * - Floor of 1 credit so a real video can never cost zero credits even if a
 *   tiny/malformed duration slips through validation.
 * - NaN / negative inputs collapse to the 1-credit floor (defensive only —
 *   route-level validation should already reject these).
 */
export function estimateVideoCredits(durationSec: number): number {
  const safe = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const credits = Math.ceil(safe * VIDEO_CREDITS_PER_SECOND);
  return Math.max(1, credits);
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
