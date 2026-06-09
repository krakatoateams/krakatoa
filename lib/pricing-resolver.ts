import {
  listPricingConfigs,
  type PricingConfig,
  type PricingType,
  type CostUnit,
} from "@/lib/pricing-configs-db";
import {
  INITIAL_DUMMY_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
  estimateProductPhotoCredits,
  estimateStoryboardImageCredits,
  estimateStoryboardVideoCredits,
} from "@/lib/credit-costs";
import {
  type BillingSettings,
  type PricingRow,
  DEFAULT_BILLING_SETTINGS,
  videoCreditsFromRow,
  imageCreditsFromRow,
  runCreditsFromRow,
  seedancePricingKey,
  veoPricingKey,
} from "@/lib/pricing-math";
import { getBillingSettings } from "@/lib/billing-settings-db";
import { productPhotoPricingKey } from "@/lib/product-photo";

/**
 * Runtime pricing resolver (Admin Phase 2, Pricing Config v2.1).
 *
 * Reads admin-editable `pricing_configs` + the `billing_settings` knobs and
 * returns the effective credit cost. Two pricing paths:
 *
 *   v2 (provider-cost): when a row has provider_cost_usd + cost_unit, credits are
 *       computed via lib/pricing-math.ts: ceil(cost_usd * units * usd_to_idr *
 *       margin / credit_value_idr) with a SINGLE final ceil (no per-second
 *       rounding).
 *   legacy: when provider_cost_usd is absent, the row's credit_amount is used
 *       (per-second rate for video, flat for image/fixed), then the
 *       lib/credit-costs.ts constants.
 *
 * Fallback chain (never throws): v2 provider_cost -> row credit_amount ->
 * legacy-key credit_amount -> lib/credit-costs.ts constant.
 *
 * Guarantees:
 *   - NEVER throws (every path returns a usable number).
 *   - Video pricing floors at 1 credit (never zero-cost).
 *   - Reads no secrets and touches no payment/external services.
 *   - Keeps a 60s TTL cache (billing settings cache lives in billing-settings-db).
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

/**
 * Coerce a possibly-string numeric (PostgREST may serialize `numeric` columns as
 * strings to preserve precision) into a finite number, or null.
 */
function coerceNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map a DB row to the normalized camelCase PricingRow used by pricing-math. */
function toRow(cfg: PricingConfig | null): PricingRow | null {
  if (!cfg) return null;
  const creditAmount = coerceNum(cfg.credit_amount);
  return {
    providerCostUsd: coerceNum(cfg.provider_cost_usd),
    costUnit: (cfg.cost_unit as CostUnit | null) ?? null,
    creditAmount: creditAmount !== null && Number.isInteger(creditAmount) ? creditAmount : null,
    enabled: Boolean(cfg.enabled),
  };
}

/** A legacy row is a usable per-second rate source. */
function usablePerSecondRate(cfg: PricingConfig | null): number | null {
  if (
    cfg &&
    cfg.enabled &&
    Number.isInteger(cfg.credit_amount) &&
    cfg.credit_amount >= 0
  ) {
    return cfg.credit_amount;
  }
  return null;
}

/** A legacy row is a usable per-image / fixed amount source. */
function usableFixedAmount(cfg: PricingConfig | null): number | null {
  if (
    cfg &&
    cfg.enabled &&
    Number.isInteger(cfg.credit_amount) &&
    cfg.credit_amount >= 0
  ) {
    return cfg.credit_amount;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Video pricing (per second) — v2 provider-cost path with fallback chain.
// ---------------------------------------------------------------------------

async function computeVideoCredits(params: {
  pricingKey: string;
  durationSec: number;
  legacyKey?: string;
}): Promise<number> {
  try {
    const [settings, row] = await Promise.all([
      getBillingSettings(),
      getPricingConfig(params.pricingKey),
    ]);

    // Legacy fallback rate: the old per-second key, else the constant.
    let fallbackRate = VIDEO_CREDITS_PER_SECOND;
    if (params.legacyKey) {
      const legacy = await getPricingConfig(params.legacyKey);
      const rate = usablePerSecondRate(legacy);
      if (rate !== null) fallbackRate = rate;
    }

    if (row?.enabled === false) {
      console.warn(`[pricing-resolver] '${params.pricingKey}' disabled — using fallback rate.`);
    }
    return videoCreditsFromRow(toRow(row), params.durationSec, settings, fallbackRate);
  } catch (e) {
    console.warn(`[pricing-resolver] video '${params.pricingKey}' failed, using constant:`, e);
    return videoCreditsFromRow(null, params.durationSec, DEFAULT_BILLING_SETTINGS, VIDEO_CREDITS_PER_SECOND);
  }
}

// ---------------------------------------------------------------------------
// Image pricing (per image) — v2 provider-cost path with fallback chain.
// ---------------------------------------------------------------------------

async function computeImageCredits(params: {
  pricingKey: string;
  imageCount: number;
  legacyKey?: string;
  fallbackConstant: number;
}): Promise<number> {
  try {
    const [settings, row] = await Promise.all([
      getBillingSettings(),
      getPricingConfig(params.pricingKey),
    ]);

    // Legacy fallback per-image amount: the old key, else the constant.
    let fallbackPerImage = params.fallbackConstant;
    if (params.legacyKey) {
      const legacy = await getPricingConfig(params.legacyKey);
      const amt = usableFixedAmount(legacy);
      if (amt !== null) fallbackPerImage = amt;
    }

    if (row?.enabled === false) {
      console.warn(`[pricing-resolver] '${params.pricingKey}' disabled — using fallback.`);
    }
    return imageCreditsFromRow(toRow(row), params.imageCount, settings, fallbackPerImage);
  } catch (e) {
    console.warn(`[pricing-resolver] image '${params.pricingKey}' failed, using constant:`, e);
    return imageCreditsFromRow(null, params.imageCount, DEFAULT_BILLING_SETTINGS, params.fallbackConstant);
  }
}

/** Resolve a legacy fixed (per-generation) credit cost with fallback. Never throws. */
async function fixedCredits(pricingKey: string, fallback: number): Promise<number> {
  try {
    const cfg = await getPricingConfig(pricingKey);
    const amt = usableFixedAmount(cfg);
    if (amt !== null) {
      if (amt === 0) {
        console.warn(`[pricing-resolver] '${pricingKey}' is set to 0 credits (free) by admin config.`);
      }
      return amt;
    }
  } catch (e) {
    console.warn(`[pricing-resolver] '${pricingKey}' fixed lookup failed, using fallback:`, e);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public tool-pricing functions.
// ---------------------------------------------------------------------------

/** ReelsGen/Seedance cost by resolution × total duration (single final ceil). */
export async function getSeedanceCredits(params: {
  resolution?: string;
  durationSec: number;
}): Promise<number> {
  return computeVideoCredits({
    pricingKey: seedancePricingKey(params.resolution),
    durationSec: params.durationSec,
    legacyKey: "seedance_video_per_second",
  });
}

/** Veo cost by resolution × total duration (single final ceil). */
export async function getVeoCredits(params: {
  resolution?: string;
  durationSec: number;
}): Promise<number> {
  return computeVideoCredits({
    pricingKey: veoPricingKey(params.resolution),
    durationSec: params.durationSec,
    legacyKey: "veo_video_per_second",
  });
}

/** Generic per-second video pricing by explicit key. */
export async function getVideoCredits(params: {
  pricingKey: string;
  durationSec: number;
  legacyKey?: string;
}): Promise<number> {
  return computeVideoCredits(params);
}

/** Generic per-image pricing by explicit key. */
export async function getImageCredits(params: {
  pricingKey: string;
  imageCount: number;
  legacyKey?: string;
  fallbackConstant?: number;
}): Promise<number> {
  return computeImageCredits({
    pricingKey: params.pricingKey,
    imageCount: params.imageCount,
    legacyKey: params.legacyKey,
    fallbackConstant: params.fallbackConstant ?? 0,
  });
}

/** Generic per-run pricing by explicit key (e.g. Whisper — informational only). */
export async function getRunCredits(params: {
  pricingKey: string;
  fallbackConstant?: number;
}): Promise<number> {
  try {
    const [settings, row] = await Promise.all([
      getBillingSettings(),
      getPricingConfig(params.pricingKey),
    ]);
    return runCreditsFromRow(toRow(row), settings, params.fallbackConstant ?? 0);
  } catch (e) {
    console.warn(`[pricing-resolver] run '${params.pricingKey}' failed, using constant:`, e);
    return Math.max(0, Math.ceil(params.fallbackConstant ?? 0));
  }
}

/** Storyboard image cost. Defaults to the `auto` quality tier (12 cr at v2 settings). */
export async function getStoryboardImageCredits(params?: {
  quality?: "low" | "medium" | "auto";
}): Promise<number> {
  const quality = params?.quality ?? "auto";
  const key =
    quality === "low"
      ? "storyboard_gpt_image_2_low_per_image"
      : quality === "medium"
        ? "storyboard_gpt_image_2_medium_per_image"
        : "storyboard_gpt_image_2_auto_per_image";
  return computeImageCredits({
    pricingKey: key,
    imageCount: 1,
    legacyKey: "storyboard_image",
    fallbackConstant: estimateStoryboardImageCredits(),
  });
}

/**
 * Product Photo cost by quality tier. standard -> 1K, ultra_4k -> 4K, low ->
 * fallback. Falls back to the legacy `product_photo` row then PRODUCT_PHOTO_CREDITS.
 */
export async function getProductPhotoCredits(params?: {
  quality?: string;
}): Promise<number> {
  const key = productPhotoPricingKey(params?.quality ?? "standard");
  return computeImageCredits({
    pricingKey: key,
    imageCount: 1,
    legacyKey: "product_photo",
    fallbackConstant: estimateProductPhotoCredits(),
  });
}

/**
 * Storyboard video cost (fixed). Pricing Config v2.1 keeps this on the legacy
 * fixed path (least-risky behavior): the storyboard-video route runs a Seedance
 * 720p 15s clip, but charging it the full per-second provider cost (~203 cr) would
 * be a large jump from the current flat 30 cr. Left as a follow-up to migrate to
 * per-second pricing intentionally. Falls back to STORYBOARD_VIDEO_CREDITS.
 */
export async function getStoryboardVideoCredits(): Promise<number> {
  return fixedCredits("storyboard_video", estimateStoryboardVideoCredits());
}

/**
 * Initial dummy credit grant (fixed). NOT consumed by generation routes — the
 * seed/trigger in 006_dummy_credits.sql grants these. Falls back to
 * INITIAL_DUMMY_CREDITS.
 */
export async function getInitialDummyCredits(): Promise<number> {
  return fixedCredits("initial_dummy_credits", INITIAL_DUMMY_CREDITS);
}

// ---------------------------------------------------------------------------
// Client-facing snapshots (used by /api/credits/pricing).
// ---------------------------------------------------------------------------

/** Legacy effective-pricing snapshot (kept for backward-compatible UI fallback). */
export type EffectivePricing = {
  seedanceRatePerSecond: number;
  veoRatePerSecond: number;
  storyboardImage: number;
  storyboardVideo: number;
  productPhoto: number;
};

/** A safe, public subset of a pricing_configs row (no audit/secret fields). */
export type PublicPricingConfig = {
  pricingKey: string;
  displayName: string;
  pricingType: PricingType;
  creditAmount: number;
  enabled: boolean;
  providerCostUsd: number | null;
  costUnit: CostUnit | null;
  pricingGroup: string | null;
  variantKey: string | null;
  currency: string;
};

function toPublicConfig(cfg: PricingConfig): PublicPricingConfig {
  return {
    pricingKey: cfg.pricing_key,
    displayName: cfg.display_name,
    pricingType: cfg.pricing_type,
    creditAmount: coerceNum(cfg.credit_amount) ?? 0,
    enabled: cfg.enabled,
    providerCostUsd: coerceNum(cfg.provider_cost_usd),
    costUnit: (cfg.cost_unit as CostUnit | null) ?? null,
    pricingGroup: cfg.pricing_group ?? null,
    variantKey: cfg.variant_key ?? null,
    currency: cfg.currency ?? "USD",
  };
}

/**
 * Effective pricing snapshot for client labels (post-fallback). Returns plain
 * numbers the UI can use directly. Never throws. The rate fields are best-effort
 * legacy values kept only as a client fallback — v2 labels compute from `configs`.
 */
export async function getEffectivePricing(): Promise<EffectivePricing> {
  const rateOf = async (key: string, fallback: number): Promise<number> => {
    const rate = usablePerSecondRate(await getPricingConfig(key));
    return rate ?? fallback;
  };

  return {
    seedanceRatePerSecond: await rateOf("seedance_video_per_second", VIDEO_CREDITS_PER_SECOND),
    veoRatePerSecond: await rateOf("veo_video_per_second", VIDEO_CREDITS_PER_SECOND),
    storyboardImage: await getStoryboardImageCredits(),
    storyboardVideo: await getStoryboardVideoCredits(),
    productPhoto: await getProductPhotoCredits(),
  };
}

/**
 * Full pricing payload for /api/credits/pricing: billing settings + the public
 * v2 config rows + the legacy snapshot. Lets the client compute labels with the
 * SAME pricing math the server bills with. Never throws.
 */
export async function getPricingPayload(): Promise<{
  billingSettings: BillingSettings;
  configs: PublicPricingConfig[];
  pricing: EffectivePricing;
}> {
  const [billingSettings, map, pricing] = await Promise.all([
    getBillingSettings(),
    getPricingMap(),
    getEffectivePricing(),
  ]);

  const configs = map
    ? Array.from(map.values()).map(toPublicConfig)
    : [];

  return { billingSettings, configs, pricing };
}
