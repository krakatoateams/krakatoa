import {
  listPricingConfigs,
  type PricingConfig,
  type PricingType,
  type CostUnit,
} from "@/lib/pricing-configs-db";
import { INITIAL_DUMMY_CREDITS, VIDEO_CREDITS_PER_SECOND } from "@/lib/credit-costs";
import {
  type BillingSettings,
  type PricingRow,
  calculateCredits,
  runCreditsFromRow,
  seedancePricingKey,
  veoPricingKey,
  videoCreditsFromRow,
  imageCreditsFromRow,
} from "@/lib/pricing-math";
import { getBillingSettings } from "@/lib/billing-settings-db";
import {
  productPhotoPricingKey,
  type ProductPhotoModelTier,
  type ProductPhotoResolution,
} from "@/lib/product-photo";
import { V2_PRICING_DEFAULTS } from "@/lib/pricing-defaults";

/**
 * Runtime pricing resolver (Pricing Config v2.2 — Clean Runtime Pricing Model).
 *
 * v2 provider-cost rows are the ONLY configurable runtime pricing source. Credits
 * are derived from the provider USD cost via lib/pricing-math.ts:
 *   credits = ceil(provider_cost_usd * unit_count * usd_to_idr
 *                  * margin_multiplier / credit_value_idr)
 * with a SINGLE final ceil (no per-second rounding; total USD first).
 *
 * Fallback chain (per pricing key):
 *   1. v2 DB row (enabled, provider_cost_usd >= 0, cost_unit) + billing_settings
 *   2. built-in v2 default (lib/pricing-defaults.ts) + billing_settings
 *   3. fail closed — throw PricingConfigError before job/spend/provider
 *
 * Removed in v2.2: the legacy-DB-row + undercharging-constant fallbacks (e.g. the
 * old 2 credits/sec `seedance_video_per_second` row). The resolver NEVER reads the
 * soft-deprecated legacy generation rows. A missing/disabled v2 row reverts to the
 * built-in v2 default (correct provider cost) — never to an undercharging legacy
 * value, and never silently free.
 *
 * Special-cased: initial_dummy_credits is a platform credit grant (fixed
 * credit_amount), NOT a generation provider-cost price — it keeps its own path.
 *
 * Guarantees:
 *   - Only throws PricingConfigError, and only for an unknown pricing key (a
 *     programming error: every tool maps to a key present in the built-in map).
 *   - Video pricing floors at 1 credit (never zero-cost).
 *   - Reads no secrets and touches no payment/external services.
 *   - 60s TTL cache (billing settings cache lives in billing-settings-db).
 */

/**
 * Thrown when a pricing key has neither a usable v2 DB row nor a built-in v2
 * default. Generation routes catch this BEFORE createJob/spend/provider and
 * return HTTP 500 with code PRICING_CONFIG_MISSING (fail closed).
 */
export class PricingConfigError extends Error {
  readonly code = "PRICING_CONFIG_MISSING" as const;
  readonly pricingKey: string;
  constructor(pricingKey: string) {
    super(
      `No pricing configuration found for "${pricingKey}". An admin must configure this provider-cost pricing before the generation can run.`
    );
    this.name = "PricingConfigError";
    this.pricingKey = pricingKey;
  }
}

const CACHE_TTL_MS = 60_000;

type PricingCache = {
  map: Map<string, PricingConfig> | null;
  expiresAt: number;
};

let cache: PricingCache = { map: null, expiresAt: 0 };

/**
 * Return a cached map of pricing_configs by pricing_key, or null if the DB read
 * fails. A failed read is not cached so the next call retries. A null map makes
 * every lookup fall back to the built-in v2 defaults (never undercharge).
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
    console.warn("[pricing-resolver] DB read failed, using built-in v2 defaults:", e);
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

/** A legacy row is a usable per-image / fixed amount source (initial credits). */
function usableFixedAmount(cfg: PricingConfig | null): number | null {
  const amt = coerceNum(cfg?.credit_amount);
  if (cfg && cfg.enabled && amt !== null && Number.isInteger(amt) && amt >= 0) {
    return amt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// v2 resolution helpers
// ---------------------------------------------------------------------------

/** Fallback per-second rate from a built-in v2 default (for row-helper fallback arg). */
function defaultPerSecondRate(pricingKey: string, settings: BillingSettings): number {
  const def = V2_PRICING_DEFAULTS[pricingKey];
  if (!def || def.costUnit !== "per_second") return VIDEO_CREDITS_PER_SECOND;
  return calculateCredits({ providerCostUsd: def.providerCostUsd, unitCount: 1, settings });
}

/** Fallback per-image amount from a built-in v2 default. */
function defaultPerImageAmount(pricingKey: string, settings: BillingSettings): number {
  const def = V2_PRICING_DEFAULTS[pricingKey];
  if (!def || def.costUnit !== "per_image") return 0;
  return calculateCredits({ providerCostUsd: def.providerCostUsd, unitCount: 1, settings });
}

/** Per-second video credits. Option A: credit_amount on DB row wins; else provider $; else built-in. */
async function computeVideoCreditsV2(
  pricingKey: string,
  durationSec: number
): Promise<number> {
  const [settings, dbRow] = await Promise.all([
    getBillingSettings(),
    getPricingConfig(pricingKey),
  ]);
  const fallbackRate = defaultPerSecondRate(pricingKey, settings);

  if (dbRow && dbRow.enabled && !dbRow.is_deprecated) {
    return videoCreditsFromRow(toRow(dbRow), durationSec, settings, fallbackRate);
  }

  const def = V2_PRICING_DEFAULTS[pricingKey];
  if (def && def.costUnit === "per_second") {
    if (dbRow && (!dbRow.enabled || dbRow.is_deprecated)) {
      console.warn(
        `[pricing-resolver] "${pricingKey}" DB row is disabled/deprecated — using built-in v2 default.`
      );
    }
    const dur = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
    return Math.max(
      1,
      calculateCredits({ providerCostUsd: def.providerCostUsd, unitCount: dur, settings })
    );
  }

  throw new PricingConfigError(pricingKey);
}

/** Per-image credits. Option A: credit_amount on DB row wins; else provider $; else built-in. */
async function computeImageCreditsV2(
  pricingKey: string,
  imageCount: number
): Promise<number> {
  const [settings, dbRow] = await Promise.all([
    getBillingSettings(),
    getPricingConfig(pricingKey),
  ]);
  const fallbackPerImage = defaultPerImageAmount(pricingKey, settings);

  if (dbRow && dbRow.enabled && !dbRow.is_deprecated) {
    return imageCreditsFromRow(toRow(dbRow), imageCount, settings, fallbackPerImage);
  }

  const def = V2_PRICING_DEFAULTS[pricingKey];
  if (def && def.costUnit === "per_image") {
    const count = Number.isFinite(imageCount) ? Math.max(0, imageCount) : 0;
    return calculateCredits({ providerCostUsd: def.providerCostUsd, unitCount: count, settings });
  }

  throw new PricingConfigError(pricingKey);
}

/**
 * Resolve a platform fixed credit amount (e.g. initial_dummy_credits). This is a
 * credit GRANT, not a provider-cost price, so it keeps the legacy credit_amount
 * path with a built-in fallback. Never throws.
 */
async function fixedCredits(pricingKey: string, fallback: number): Promise<number> {
  try {
    const cfg = await getPricingConfig(pricingKey);
    const amt = usableFixedAmount(cfg);
    if (amt !== null) return amt;
  } catch (e) {
    console.warn(`[pricing-resolver] "${pricingKey}" fixed lookup failed, using fallback:`, e);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Public tool-pricing functions (all v2 provider-cost based).
// ---------------------------------------------------------------------------

/** ReelsGen/Seedance cost by resolution × total duration (single final ceil). */
export async function getSeedanceCredits(params: {
  resolution?: string;
  durationSec: number;
}): Promise<number> {
  return computeVideoCreditsV2(seedancePricingKey(params.resolution), params.durationSec);
}

/** Veo cost by resolution × total duration (single final ceil). */
export async function getVeoCredits(params: {
  resolution?: string;
  durationSec: number;
}): Promise<number> {
  return computeVideoCreditsV2(veoPricingKey(params.resolution), params.durationSec);
}

/** Generic per-second video pricing by explicit v2 key (fail closed if unknown). */
export async function getVideoCredits(params: {
  pricingKey: string;
  durationSec: number;
}): Promise<number> {
  return computeVideoCreditsV2(params.pricingKey, params.durationSec);
}

/** Generic per-image pricing by explicit v2 key (fail closed if unknown). */
export async function getImageCredits(params: {
  pricingKey: string;
  imageCount: number;
}): Promise<number> {
  return computeImageCreditsV2(params.pricingKey, params.imageCount);
}

/**
 * Generic per-run pricing by explicit key (informational/analytics only — e.g.
 * Whisper). Soft: returns the fallback when no usable row exists (never throws,
 * never blocks a generation, since this is not a charged path).
 */
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
    console.warn(`[pricing-resolver] run "${params.pricingKey}" failed, using constant:`, e);
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
  return computeImageCreditsV2(key, 1);
}

/**
 * Storyboard IMPORT cost — the GPT-5 vision pass that turns a user-uploaded
 * storyboard sheet into a seedance_prompt (no image is generated). Fail-closed
 * via the v2 chain like every other charged key. Default ~3 cr.
 */
export async function getStoryboardImportCredits(): Promise<number> {
  return computeImageCreditsV2("storyboard_import_vision_per_image", 1);
}

/**
 * Product Photo cost by model tier + resolution (v2.3).
 *   - basic    -> product_photo_nano_banana_per_image (no resolution)
 *   - balanced -> product_photo_nano_banana_2_{1k,2k,4k}_per_image
 *   - pro      -> product_photo_nano_banana_pro_{1k,2k,4k}_per_image
 * v2 provider-cost based. Fails closed on an unknown tier/resolution pricing key;
 * never falls back to the deprecated ambiguous product_photo_{1k,2k,4k} keys.
 */
export async function getProductPhotoCredits(params: {
  modelTier: ProductPhotoModelTier;
  resolution: ProductPhotoResolution | null;
}): Promise<number> {
  const key = productPhotoPricingKey({
    modelTier: params.modelTier,
    resolution: params.resolution,
  });
  return computeImageCreditsV2(key, 1);
}

/**
 * Initial dummy credit grant (fixed). NOT consumed by generation routes — the
 * seed/trigger in 006_dummy_credits.sql grants these. Falls back to
 * INITIAL_DUMMY_CREDITS. (Platform credit grant, not a provider-cost price.)
 */
export async function getInitialDummyCredits(): Promise<number> {
  return fixedCredits("initial_dummy_credits", INITIAL_DUMMY_CREDITS);
}

// ---------------------------------------------------------------------------
// Client-facing payload (used by /api/credits/pricing).
// ---------------------------------------------------------------------------

/**
 * A safe, public subset of a v2 pricing_configs row (no audit/secret fields).
 * Only PRIMARY v2 provider-cost rows are exposed — never legacy/deprecated rows.
 */
export type PublicPricingConfig = {
  pricingKey: string;
  displayName: string;
  pricingType: PricingType;
  enabled: boolean;
  /** Admin-set charge (Option A). When set, runtime bills this instead of deriving from provider $. */
  creditAmount: number | null;
  providerCostUsd: number | null;
  costUnit: CostUnit | null;
  pricingGroup: string | null;
  variantKey: string | null;
  currency: string;
  /** Credits for ONE unit — matches runtime charge at current billing settings. */
  computedCreditsPreview: number;
  /** Always true for rows in this payload — they are the runtime pricing source. */
  isPrimaryRuntimePrice: true;
};

function toPublicConfig(cfg: PricingConfig, settings: BillingSettings): PublicPricingConfig {
  const providerCostUsd = coerceNum(cfg.provider_cost_usd);
  const rawCredit = coerceNum(cfg.credit_amount);
  const creditAmount =
    rawCredit !== null && Number.isInteger(rawCredit) && rawCredit >= 0 ? rawCredit : null;
  const computedCreditsPreview =
    creditAmount !== null
      ? creditAmount
      : providerCostUsd !== null
        ? calculateCredits({ providerCostUsd, unitCount: 1, settings })
        : 0;
  return {
    pricingKey: cfg.pricing_key,
    displayName: cfg.display_name,
    pricingType: cfg.pricing_type,
    enabled: cfg.enabled,
    creditAmount,
    providerCostUsd,
    costUnit: (cfg.cost_unit as CostUnit | null) ?? null,
    pricingGroup: cfg.pricing_group ?? null,
    variantKey: cfg.variant_key ?? null,
    currency: cfg.currency ?? "USD",
    computedCreditsPreview,
    isPrimaryRuntimePrice: true,
  };
}

/** A v2 row is a primary runtime price: not deprecated, with a provider cost + unit. */
function isPrimaryV2Row(cfg: PricingConfig): boolean {
  return (
    !cfg.is_deprecated &&
    coerceNum(cfg.provider_cost_usd) !== null &&
    ((cfg.cost_unit as CostUnit | null) ?? null) !== null
  );
}

/**
 * Pricing payload for /api/credits/pricing: billing settings + the PRIMARY v2
 * provider-cost configs only. Legacy/deprecated rows are never exposed. Lets the
 * client compute labels with the SAME pricing math the server bills with. The
 * client falls back to the built-in v2 defaults (lib/pricing-defaults.ts) for any
 * key not present here. Never throws.
 */
export async function getPricingPayload(): Promise<{
  billingSettings: BillingSettings;
  configs: PublicPricingConfig[];
}> {
  const [billingSettings, map] = await Promise.all([
    getBillingSettings(),
    getPricingMap(),
  ]);

  const configs = map
    ? Array.from(map.values())
        .filter(isPrimaryV2Row)
        .map((cfg) => toPublicConfig(cfg, billingSettings))
    : [];

  return { billingSettings, configs };
}
