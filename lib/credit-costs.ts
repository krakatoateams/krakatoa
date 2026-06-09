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
