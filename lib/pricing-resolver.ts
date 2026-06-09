import {
  listPricingConfigs,
  type PricingConfig,
} from "@/lib/pricing-configs-db";
import {
  INITIAL_DUMMY_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
  estimateProductPhotoCredits,
  estimateStoryboardImageCredits,
  estimateStoryboardVideoCredits,
  roundVideoCredits,
} from "@/lib/credit-costs";

/**
 * Runtime pricing resolver (Admin Phase 2).
 *
 * Reads admin-editable `pricing_configs` and returns the effective credit cost,
 * falling back to the canonical constants in `lib/credit-costs.ts` whenever the
 * DB row is missing, disabled, malformed, or the query fails.
 *
 * Guarantees:
 *   - NEVER throws (every path returns a usable number).
 *   - DB value used only when enabled=true and credit_amount is a valid int >= 0.
 *   - per_second pricing treats credit_amount as credits-per-second.
 *   - Video pricing floors at 1 credit (never zero-cost) via roundVideoCredits.
 *   - Fixed pricing honors an admin-set 0 (intentional free) with a warning.
 *   - Reads no secrets and touches no payment/external services.
 */

const CACHE_TTL_MS = 60_000;

type PricingCache = {
  map: Map<string, PricingConfig> | null;
  expiresAt: number;
};

let cache: PricingCache = { map: null, expiresAt: 0 };

/**
 * Return a cached map of pricing_configs by pricing_key, or null if the DB read
 * fails. A failed read is not cached so the next call retries.
 */
async function getPricingMap(): Promise<Map<string, PricingConfig> | null> {
  const now = Date.now();
  if (cache.map && now < cache.expiresAt) return cache.map;

  try {
    const rows = await listPricingConfigs();
    const map = new Map<string, PricingConfig>();
    for (const row of rows) map.set(row.pricing_key, row);
    cache = { map, expiresAt: now + CACHE_TTL_MS };
    return map;
  } catch (e) {
    console.warn("[pricing-resolver] DB read failed, using fallback constants:", e);
    return null;
  }
}

/** Fetch a single pricing config row, or null on miss/error. Never throws. */
export async function getPricingConfig(
  pricingKey: string
): Promise<PricingConfig | null> {
  const map = await getPricingMap();
  return map?.get(pricingKey) ?? null;
}

/** A row is usable when present, enabled, and credit_amount is a valid int >= 0. */
function isUsable(cfg: PricingConfig | null): cfg is PricingConfig {
  return Boolean(
    cfg &&
      cfg.enabled &&
      Number.isInteger(cfg.credit_amount) &&
      cfg.credit_amount >= 0
  );
}

/** Resolve a fixed (per-generation / per-image) credit cost with fallback. */
async function fixedCredits(pricingKey: string, fallback: number): Promise<number> {
  try {
    const cfg = await getPricingConfig(pricingKey);
    if (isUsable(cfg)) {
      if (cfg.credit_amount === 0) {
        console.warn(
          `[pricing-resolver] '${pricingKey}' is set to 0 credits (free) by admin config.`
        );
      }
      return cfg.credit_amount;
    }
  } catch (e) {
    console.warn(`[pricing-resolver] '${pricingKey}' fixed lookup failed, using fallback:`, e);
  }
  return fallback;
}

/** Resolve a per-second video rate with fallback, then round to integer credits. */
async function videoCredits(
  pricingKey: string,
  durationSec: number,
  fallbackRatePerSecond: number
): Promise<number> {
  let rate = fallbackRatePerSecond;
  try {
    const cfg = await getPricingConfig(pricingKey);
    if (isUsable(cfg) && cfg.pricing_type === "per_second") {
      rate = cfg.credit_amount;
    } else if (cfg && (!cfg.enabled || cfg.pricing_type !== "per_second")) {
      console.warn(
        `[pricing-resolver] '${pricingKey}' not usable as per_second, using fallback rate.`
      );
    }
  } catch (e) {
    console.warn(`[pricing-resolver] '${pricingKey}' rate lookup failed, using fallback:`, e);
  }
  return roundVideoCredits(durationSec, rate);
}

/** Product Photo cost (fixed). Falls back to PRODUCT_PHOTO_CREDITS. */
export async function getProductPhotoCredits(): Promise<number> {
  return fixedCredits("product_photo", estimateProductPhotoCredits());
}

/** Storyboard image cost (fixed). Falls back to STORYBOARD_IMAGE_CREDITS. */
export async function getStoryboardImageCredits(): Promise<number> {
  return fixedCredits("storyboard_image", estimateStoryboardImageCredits());
}

/** Storyboard video cost (fixed). Falls back to STORYBOARD_VIDEO_CREDITS. */
export async function getStoryboardVideoCredits(): Promise<number> {
  return fixedCredits("storyboard_video", estimateStoryboardVideoCredits());
}

/** ReelsGen/Seedance cost: total duration x seedance per-second rate. */
export async function getSeedanceCredits(params: {
  sceneCount: number;
  durationPerScene: number;
}): Promise<number> {
  const totalDuration = params.sceneCount * params.durationPerScene;
  return videoCredits("seedance_video_per_second", totalDuration, VIDEO_CREDITS_PER_SECOND);
}

/** Veo cost: total duration x veo per-second rate. */
export async function getVeoCredits(params: { durationSec: number }): Promise<number> {
  return videoCredits("veo_video_per_second", params.durationSec, VIDEO_CREDITS_PER_SECOND);
}

/** Generic per-second video pricing by key, with the default rate as fallback. */
export async function getVideoCredits(params: {
  pricingKey: string;
  durationSec: number;
  fallbackRatePerSecond?: number;
}): Promise<number> {
  return videoCredits(
    params.pricingKey,
    params.durationSec,
    params.fallbackRatePerSecond ?? VIDEO_CREDITS_PER_SECOND
  );
}

/**
 * Initial dummy credit grant (fixed). NOTE: not consumed by generation routes —
 * the seed/trigger in 006_dummy_credits.sql grants these. Exposed for parity and
 * any future admin tooling. Falls back to INITIAL_DUMMY_CREDITS.
 */
export async function getInitialDummyCredits(): Promise<number> {
  return fixedCredits("initial_dummy_credits", INITIAL_DUMMY_CREDITS);
}

/**
 * Effective pricing snapshot for client labels (post-fallback). Returns plain
 * numbers/types the UI can use directly. Never throws.
 */
export async function getEffectivePricing(): Promise<{
  seedanceRatePerSecond: number;
  veoRatePerSecond: number;
  storyboardImage: number;
  storyboardVideo: number;
  productPhoto: number;
}> {
  const rateOf = async (key: string, fallback: number): Promise<number> => {
    const cfg = await getPricingConfig(key);
    return isUsable(cfg) && cfg.pricing_type === "per_second"
      ? cfg.credit_amount
      : fallback;
  };

  return {
    seedanceRatePerSecond: await rateOf("seedance_video_per_second", VIDEO_CREDITS_PER_SECOND),
    veoRatePerSecond: await rateOf("veo_video_per_second", VIDEO_CREDITS_PER_SECOND),
    storyboardImage: await getStoryboardImageCredits(),
    storyboardVideo: await getStoryboardVideoCredits(),
    productPhoto: await getProductPhotoCredits(),
  };
}
