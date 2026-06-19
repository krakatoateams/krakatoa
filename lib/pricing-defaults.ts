import type { CostUnit, PricingRow } from "@/lib/pricing-math";

/**
 * Built-in v2 pricing defaults (Pricing Config v2.2).
 *
 * Typed, in-code source of the provider USD cost for every v2 pricing key. This
 * map is the SINGLE fallback the runtime resolver and the client pricing context
 * use when a v2 `pricing_configs` row is missing, disabled, or has no
 * provider_cost_usd. It deliberately REPLACES the old legacy-DB-row /
 * undercharging-constant fallback (e.g. 2 credits/sec) so a missing/disabled row
 * can never silently undercharge.
 *
 * Fallback chain (server + client, identical):
 *   1. v2 DB row (provider_cost_usd + cost_unit) + billing_settings
 *   2. this built-in default + billing_settings
 *   3. fail closed (PricingConfigError) — unknown key, before job/spend/provider
 *
 * Numbers are the approved internal-testing provider costs. With the current
 * billing knobs (usd_to_idr=18000, credit_value_idr=200, margin=1.0 → factor 90):
 *   product 1K/2K  0.15 → 14 cr/img    product 4K   0.30 → 27 cr/img
 *   storyboard auto 0.128 → 12 cr/img  seedance 480p 0.07 → 95 cr/15s
 *   seedance 720p  0.15 → 203 cr/15s   veo 720p 0.05 → 68 cr/15s
 *
 * Client-safe: imports only TYPES from lib/pricing-math.ts (no server modules).
 */

export type V2PricingDefault = {
  providerCostUsd: number;
  costUnit: CostUnit;
  pricingGroup: string;
  variantKey: string;
};

export const V2_PRICING_DEFAULTS: Record<string, V2PricingDefault> = {
  // Seedance (per second) — also powers Storyboard Video pricing.
  // "non_video_in" variant (no reference video input): used by Reels/Storyboard
  // and by Text to Video unless a reference video is attached.
  seedance_480p_per_second: { providerCostUsd: 0.07, costUnit: "per_second", pricingGroup: "seedance", variantKey: "480p" },
  seedance_720p_per_second: { providerCostUsd: 0.15, costUnit: "per_second", pricingGroup: "seedance", variantKey: "720p" },
  // "video_in" variant (a reference video is provided) — Seedance charges more.
  seedance_480p_video_in_per_second: { providerCostUsd: 0.08, costUnit: "per_second", pricingGroup: "seedance", variantKey: "480p_video_in" },
  seedance_720p_video_in_per_second: { providerCostUsd: 0.17, costUnit: "per_second", pricingGroup: "seedance", variantKey: "720p_video_in" },
  // Seedance 2.0 (full, bytedance/seedance-2.0) — pricier than the Fast variant and
  // adds a 1080p tier. non_video_in (no reference video).
  seedance2_480p_per_second: { providerCostUsd: 0.08, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "480p" },
  seedance2_720p_per_second: { providerCostUsd: 0.18, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "720p" },
  seedance2_1080p_per_second: { providerCostUsd: 0.45, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "1080p" },
  // Seedance 2.0 (full) — video_in (a reference video is provided).
  seedance2_480p_video_in_per_second: { providerCostUsd: 0.10, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "480p_video_in" },
  seedance2_720p_video_in_per_second: { providerCostUsd: 0.22, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "720p_video_in" },
  seedance2_1080p_video_in_per_second: { providerCostUsd: 0.55, costUnit: "per_second", pricingGroup: "seedance2", variantKey: "1080p_video_in" },
  // Veo (per second).
  veo_720p_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "veo", variantKey: "720p" },
  veo_1080p_per_second: { providerCostUsd: 0.08, costUnit: "per_second", pricingGroup: "veo", variantKey: "1080p" },
  // Veo 3.1 Fast (google/veo-3.1-fast, Text to Video). Priced by AUDIO, not
  // resolution: with audio costs more than without.
  veo31fast_with_audio_per_second: { providerCostUsd: 0.15, costUnit: "per_second", pricingGroup: "veo31fast", variantKey: "with_audio" },
  veo31fast_without_audio_per_second: { providerCostUsd: 0.10, costUnit: "per_second", pricingGroup: "veo31fast", variantKey: "without_audio" },
  // Storyboard image / GPT Image 2 (per image).
  storyboard_gpt_image_2_low_per_image: { providerCostUsd: 0.012, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "low" },
  storyboard_gpt_image_2_medium_per_image: { providerCostUsd: 0.047, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "medium" },
  storyboard_gpt_image_2_auto_per_image: { providerCostUsd: 0.128, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "auto" },
  // Product Photo model tiers (per image) — v2.3.
  //   basic    -> google/nano-banana      (no resolution)
  //   balanced -> google/nano-banana-2     (1K/2K/4K)
  //   pro      -> google/nano-banana-pro   (1K/2K/4K)
  // NOTE: the old ambiguous product_photo_{fallback,1k,2k,4k}_per_image keys are
  // deprecated (migration 011) and intentionally NOT in this map — runtime never
  // resolves them.
  product_photo_nano_banana_per_image: { providerCostUsd: 0.039, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "basic" },
  product_photo_nano_banana_2_1k_per_image: { providerCostUsd: 0.067, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "balanced_1k" },
  product_photo_nano_banana_2_2k_per_image: { providerCostUsd: 0.101, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "balanced_2k" },
  product_photo_nano_banana_2_4k_per_image: { providerCostUsd: 0.151, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "balanced_4k" },
  product_photo_nano_banana_pro_1k_per_image: { providerCostUsd: 0.15, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "pro_1k" },
  product_photo_nano_banana_pro_2k_per_image: { providerCostUsd: 0.15, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "pro_2k" },
  product_photo_nano_banana_pro_4k_per_image: { providerCostUsd: 0.30, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "pro_4k" },
  // Extended Product Photo / omni-form models (per image) — single price each,
  // no resolution tiers. Approx Replicate provider costs.
  product_photo_seedream_4_per_image: { providerCostUsd: 0.03, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "seedream4" },
  product_photo_flux_kontext_pro_per_image: { providerCostUsd: 0.04, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "flux_kontext" },
  product_photo_flux_1_1_pro_per_image: { providerCostUsd: 0.04, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "flux11" },
  product_photo_imagen_4_per_image: { providerCostUsd: 0.04, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "imagen4" },
  product_photo_ideogram_v3_turbo_per_image: { providerCostUsd: 0.03, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "ideogram3" },
  product_photo_seedream_3_per_image: { providerCostUsd: 0.03, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "seedream3" },
  product_photo_flux_schnell_per_image: { providerCostUsd: 0.003, costUnit: "per_image", pricingGroup: "product_photo", variantKey: "flux_schnell" },
};

/** Built-in v2 default for a pricing key, or null if the key is unknown. */
export function getV2PricingDefault(pricingKey: string): V2PricingDefault | null {
  return V2_PRICING_DEFAULTS[pricingKey] ?? null;
}

/** Build a normalized PricingRow from the built-in default (for shared math). */
export function v2DefaultRow(pricingKey: string): PricingRow | null {
  const d = V2_PRICING_DEFAULTS[pricingKey];
  if (!d) return null;
  return {
    providerCostUsd: d.providerCostUsd,
    costUnit: d.costUnit,
    creditAmount: null,
    enabled: true,
  };
}
