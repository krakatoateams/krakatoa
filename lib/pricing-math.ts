import { VIDEO_CREDITS_PER_SECOND, roundVideoCredits } from "@/lib/credit-costs";

/**
 * Shared pricing math (Pricing Config v2.1).
 *
 * Pure, dependency-free (except the pure constants in lib/credit-costs.ts) module
 * imported by BOTH the server resolver (lib/pricing-resolver.ts) and the client
 * pricing context (app/(app)/pricing-context.tsx) so the credit formula has a
 * SINGLE source of truth and labels never drift from billing.
 *
 * Core formula:
 *   credits = ceil(provider_cost_usd * unit_count * usd_to_idr
 *                  * margin_multiplier / credit_value_idr)
 *
 * With the current internal-testing knobs (usd_to_idr=18000, credit_value_idr=200,
 * margin_multiplier=1.0) this is exactly `ceil(cost_usd * units * 90)`.
 *
 * Rounding rule: round ONCE, at the end. For duration-based pricing the caller
 * passes the TOTAL units (e.g. total seconds), never the per-second amount — so we
 * never round per-second first (that would inflate the charge, e.g. 203 -> 210).
 *
 * Guarantees: never throws, never returns NaN/Infinity. Invalid inputs collapse to
 * 0 (or, for video helpers, the 1-credit floor).
 */

export type CostUnit = "per_image" | "per_second" | "per_run" | "per_1k_tokens";

export type BillingSettings = {
  usdToIdr: number;
  creditValueIdr: number;
  marginMultiplier: number;
  roundingMode: "ceil_final";
};

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  usdToIdr: 18000,
  creditValueIdr: 200,
  marginMultiplier: 1.0,
  roundingMode: "ceil_final",
};

// Float-noise guard so e.g. 0.30 * 90 = 27.0000000004 does not ceil to 28. Real
// fractional costs (>= 1e-9 above an integer) still round up correctly.
const CEIL_EPSILON = 1e-9;

type CalculateCreditsParams = {
  providerCostUsd: number;
  unitCount: number;
  settings?: BillingSettings;
};

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Coerce possibly-malformed settings to a fully valid object (defaults per field). */
export function normalizeBillingSettings(
  raw: Partial<BillingSettings> | null | undefined
): BillingSettings {
  if (!raw) return DEFAULT_BILLING_SETTINGS;
  return {
    usdToIdr: isFinitePositive(raw.usdToIdr) ? raw.usdToIdr : DEFAULT_BILLING_SETTINGS.usdToIdr,
    creditValueIdr: isFinitePositive(raw.creditValueIdr)
      ? raw.creditValueIdr
      : DEFAULT_BILLING_SETTINGS.creditValueIdr,
    marginMultiplier: isFiniteNonNegative(raw.marginMultiplier)
      ? raw.marginMultiplier
      : DEFAULT_BILLING_SETTINGS.marginMultiplier,
    roundingMode: "ceil_final",
  };
}

/**
 * Core credit calculation. Accepts either the object form
 * `calculateCredits({ providerCostUsd, unitCount, settings })` or the positional
 * form `calculateCredits(providerCostUsd, unitCount, settings?)`.
 *
 * Returns an integer >= 0 (single final ceil). Returns 0 when cost or units are 0.
 */
export function calculateCredits(
  arg1: number | CalculateCreditsParams,
  unitCount?: number,
  settings?: BillingSettings
): number {
  let providerCostUsd: number;
  let units: number;
  let rawSettings: BillingSettings | undefined;

  if (typeof arg1 === "object" && arg1 !== null) {
    providerCostUsd = arg1.providerCostUsd;
    units = arg1.unitCount;
    rawSettings = arg1.settings;
  } else {
    providerCostUsd = arg1;
    units = unitCount ?? 0;
    rawSettings = settings;
  }

  const s = normalizeBillingSettings(rawSettings);

  if (!isFiniteNonNegative(providerCostUsd) || !isFiniteNonNegative(units)) return 0;
  if (providerCostUsd === 0 || units === 0) return 0;

  const idr = providerCostUsd * units * s.usdToIdr * s.marginMultiplier;
  const credits = idr / s.creditValueIdr;
  if (!Number.isFinite(credits) || credits <= 0) return 0;

  return Math.ceil(credits - CEIL_EPSILON);
}

// ---------------------------------------------------------------------------
// Row-level helpers (shared fallback chain).
//
// Both server and client operate on this normalized, camelCase row shape so the
// fallback chain (v2 provider cost -> legacy credit_amount -> constant) is
// identical everywhere.
// ---------------------------------------------------------------------------

export type PricingRow = {
  providerCostUsd: number | null;
  costUnit: CostUnit | null;
  creditAmount: number | null;
  enabled: boolean;
};

function usableCreditAmount(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/**
 * Video (per-second) credits with the v2 -> legacy -> constant fallback chain.
 * Always floors at 1 credit (video is never zero-cost). `durationSec` is the TOTAL
 * duration; the single final ceil happens inside calculateCredits.
 */
export function videoCreditsFromRow(
  row: PricingRow | null | undefined,
  durationSec: number,
  settings: BillingSettings,
  fallbackRatePerSecond: number = VIDEO_CREDITS_PER_SECOND
): number {
  const dur = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  if (row && row.enabled) {
    if (isFiniteNonNegative(row.providerCostUsd) && row.costUnit === "per_second") {
      return Math.max(1, calculateCredits({ providerCostUsd: row.providerCostUsd, unitCount: dur, settings }));
    }
    if (usableCreditAmount(row.creditAmount)) {
      return roundVideoCredits(dur, row.creditAmount);
    }
  }
  return roundVideoCredits(dur, fallbackRatePerSecond);
}

/**
 * Image (per-image) credits with the v2 -> legacy -> constant fallback chain.
 * No 1-credit floor: an admin-set 0 (free) is honored.
 */
export function imageCreditsFromRow(
  row: PricingRow | null | undefined,
  imageCount: number,
  settings: BillingSettings,
  fallbackPerImage: number
): number {
  const count = Number.isFinite(imageCount) ? Math.max(0, imageCount) : 0;
  if (row && row.enabled) {
    if (isFiniteNonNegative(row.providerCostUsd) && row.costUnit === "per_image") {
      return calculateCredits({ providerCostUsd: row.providerCostUsd, unitCount: count, settings });
    }
    if (usableCreditAmount(row.creditAmount)) {
      return Math.max(0, Math.ceil(row.creditAmount * count - CEIL_EPSILON));
    }
  }
  const safeFallback = isFiniteNonNegative(fallbackPerImage) ? fallbackPerImage : 0;
  return Math.max(0, Math.ceil(safeFallback * count - CEIL_EPSILON));
}

/**
 * Run (per-run) credits with the v2 -> legacy -> constant fallback chain.
 * One run = unit_count 1.
 */
export function runCreditsFromRow(
  row: PricingRow | null | undefined,
  settings: BillingSettings,
  fallbackCredits: number
): number {
  if (row && row.enabled) {
    if (isFiniteNonNegative(row.providerCostUsd) && row.costUnit === "per_run") {
      return calculateCredits({ providerCostUsd: row.providerCostUsd, unitCount: 1, settings });
    }
    if (usableCreditAmount(row.creditAmount)) {
      return row.creditAmount;
    }
  }
  return isFiniteNonNegative(fallbackCredits) ? Math.ceil(fallbackCredits) : 0;
}

// ---------------------------------------------------------------------------
// Pricing-key mappings (shared by client + server so resolution/quality always
// resolve to the same key on both sides).
// ---------------------------------------------------------------------------

/** Seedance resolution -> v2 pricing key. Anything not 720p maps to 480p. */
export function seedancePricingKey(resolution: string | null | undefined): string {
  return resolution === "720p" ? "seedance_720p_per_second" : "seedance_480p_per_second";
}

/**
 * Seedance 2 FAST pricing key, variant-aware. Seedance charges a higher per-second
 * rate when a reference VIDEO is provided ("video_in") vs not ("non_video_in").
 * Used by Text to Video (Seedance 2 Fast). Reels/Storyboard (no video input) keep
 * seedancePricingKey() which always resolves to the non_video_in keys.
 */
export function seedanceFastPricingKey(params: {
  resolution: string | null | undefined;
  hasReferenceVideo: boolean;
}): string {
  const is720 = params.resolution === "720p";
  if (params.hasReferenceVideo) {
    return is720 ? "seedance_720p_video_in_per_second" : "seedance_480p_video_in_per_second";
  }
  return is720 ? "seedance_720p_per_second" : "seedance_480p_per_second";
}

/**
 * Seedance 2.0 (full, bytedance/seedance-2.0) pricing key, variant-aware. Pricier
 * than the Fast variant and supports a 1080p tier. "video_in" applies when a
 * reference video is provided.
 */
export function seedance2PricingKey(params: {
  resolution: string | null | undefined;
  hasReferenceVideo: boolean;
}): string {
  const res =
    params.resolution === "1080p" ? "1080p" : params.resolution === "720p" ? "720p" : "480p";
  const suffix = params.hasReferenceVideo ? "_video_in_per_second" : "_per_second";
  return `seedance2_${res}${suffix}`;
}

/**
 * Seedance 2.0 Mini (bytedance/seedance-2.0-mini) pricing key, variant-aware.
 * Cheaper than Fast; 480p/720p only (no 1080p tier).
 */
export function seedance2MiniPricingKey(params: {
  resolution: string | null | undefined;
  hasReferenceVideo: boolean;
}): string {
  const is720 = params.resolution === "720p";
  if (params.hasReferenceVideo) {
    return is720
      ? "seedance2mini_720p_video_in_per_second"
      : "seedance2mini_480p_video_in_per_second";
  }
  return is720 ? "seedance2mini_720p_per_second" : "seedance2mini_480p_per_second";
}

/**
 * Seedance 1.5 Pro (bytedance/seedance-1.5-pro) pricing key. Priced by resolution
 * × audio (with_audio / without_audio). Text to Video only.
 */
export function seedance15PricingKey(params: {
  resolution: string | null | undefined;
  generateAudio: boolean;
}): string {
  const res =
    params.resolution === "1080p" ? "1080p" : params.resolution === "720p" ? "720p" : "480p";
  const audio = params.generateAudio ? "with_audio" : "without_audio";
  return `seedance15_${res}_${audio}_per_second`;
}

/**
 * Seedance 1 Pro Fast (bytedance/seedance-1-pro-fast) pricing key. Priced by
 * resolution only (no audio generation). Text to Video only.
 */
export function seedance1ProFastPricingKey(resolution: string | null | undefined): string {
  const res =
    resolution === "1080p" ? "1080p" : resolution === "720p" ? "720p" : "480p";
  return `seedance1fast_${res}_per_second`;
}

/** Veo resolution -> v2 pricing key. Anything not 1080p maps to 720p. */
export function veoPricingKey(resolution: string | null | undefined): string {
  return resolution === "1080p" ? "veo_1080p_per_second" : "veo_720p_per_second";
}

/**
 * Veo 3.1 Fast (google/veo-3.1-fast) pricing key. Unlike Seedance/Veo above, this
 * model is priced by AUDIO, not resolution: generating audio costs more.
 */
export function veo31FastPricingKey(params: { generateAudio: boolean }): string {
  return params.generateAudio
    ? "veo31fast_with_audio_per_second"
    : "veo31fast_without_audio_per_second";
}

/** Veo 3.1 Lite (google/veo-3.1-lite) pricing key. No audio; priced by resolution. */
export function veo31LitePricingKey(resolution: string | null | undefined): string {
  return resolution === "1080p" ? "veo31lite_1080p_per_second" : "veo31lite_720p_per_second";
}

/**
 * Kling v3 (kwaivgi/kling-v3-video) pricing key. Priced by mode (standard=720p /
 * pro=1080p / 4k) × audio. 4k is a flat rate regardless of audio.
 */
export function klingV3PricingKey(params: {
  resolution: string | null | undefined;
  generateAudio: boolean;
}): string {
  if (params.resolution === "4k") return "kling3_4k_per_second";
  if (params.resolution === "720p") {
    return params.generateAudio
      ? "kling3_standard_audio_per_second"
      : "kling3_standard_per_second";
  }
  // 1080p (pro) is the default tier.
  return params.generateAudio ? "kling3_pro_audio_per_second" : "kling3_pro_per_second";
}

/**
 * Kling v3 Motion Control (kwaivgi/kling-v3-motion-control) pricing key. Priced by
 * mode: std (720p) vs pro (1080p). Output duration follows the reference video.
 */
export function klingV3MotionControlPricingKey(mode: string | null | undefined): string {
  return mode === "std" ? "kling3mc_std_per_second" : "kling3mc_pro_per_second";
}
