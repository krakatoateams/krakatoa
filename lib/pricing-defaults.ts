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
 *   seedance 720p  0.15 → 203 cr/15s  seedance2mini 480p 0.04 → 54 cr/15s
 *   seedance2mini 720p 0.09 → 122 cr/15s   veo 720p 0.05 → 68 cr/15s
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
  // Seedance 2.0 Mini (bytedance/seedance-2.0-mini) — Storyboard + Text to Video.
  // non_video_in (no reference video): 480p $0.04/s · 720p $0.09/s
  // video_in (reference video):         480p $0.05/s · 720p $0.11/s
  seedance2mini_480p_per_second: { providerCostUsd: 0.04, costUnit: "per_second", pricingGroup: "seedance2mini", variantKey: "480p" },
  seedance2mini_720p_per_second: { providerCostUsd: 0.09, costUnit: "per_second", pricingGroup: "seedance2mini", variantKey: "720p" },
  seedance2mini_480p_video_in_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "seedance2mini", variantKey: "480p_video_in" },
  seedance2mini_720p_video_in_per_second: { providerCostUsd: 0.11, costUnit: "per_second", pricingGroup: "seedance2mini", variantKey: "720p_video_in" },
  // Seedance 1.5 Pro (bytedance/seedance-1.5-pro) — Text to Video. Priced by
  // resolution × audio (with_audio / without_audio).
  seedance15_480p_with_audio_per_second: { providerCostUsd: 0.025, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "480p_with_audio" },
  seedance15_720p_with_audio_per_second: { providerCostUsd: 0.052, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "720p_with_audio" },
  seedance15_1080p_with_audio_per_second: { providerCostUsd: 0.12, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "1080p_with_audio" },
  seedance15_480p_without_audio_per_second: { providerCostUsd: 0.013, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "480p_without_audio" },
  seedance15_720p_without_audio_per_second: { providerCostUsd: 0.026, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "720p_without_audio" },
  seedance15_1080p_without_audio_per_second: { providerCostUsd: 0.06, costUnit: "per_second", pricingGroup: "seedance15", variantKey: "1080p_without_audio" },
  // Seedance 1 Pro Fast (bytedance/seedance-1-pro-fast) — Text to Video, no audio.
  seedance1fast_480p_per_second: { providerCostUsd: 0.015, costUnit: "per_second", pricingGroup: "seedance1fast", variantKey: "480p" },
  seedance1fast_720p_per_second: { providerCostUsd: 0.025, costUnit: "per_second", pricingGroup: "seedance1fast", variantKey: "720p" },
  seedance1fast_1080p_per_second: { providerCostUsd: 0.06, costUnit: "per_second", pricingGroup: "seedance1fast", variantKey: "1080p" },
  // Seedance 1 Pro (bytedance/seedance-1-pro) — Text to Video, no audio.
  seedance1pro_480p_per_second: { providerCostUsd: 0.03, costUnit: "per_second", pricingGroup: "seedance1pro", variantKey: "480p" },
  seedance1pro_720p_per_second: { providerCostUsd: 0.06, costUnit: "per_second", pricingGroup: "seedance1pro", variantKey: "720p" },
  seedance1pro_1080p_per_second: { providerCostUsd: 0.15, costUnit: "per_second", pricingGroup: "seedance1pro", variantKey: "1080p" },
  // Seedance 1 Lite (bytedance/seedance-1-lite) — Text to Video, no audio.
  seedance1lite_480p_per_second: { providerCostUsd: 0.018, costUnit: "per_second", pricingGroup: "seedance1lite", variantKey: "480p" },
  seedance1lite_720p_per_second: { providerCostUsd: 0.036, costUnit: "per_second", pricingGroup: "seedance1lite", variantKey: "720p" },
  seedance1lite_1080p_per_second: { providerCostUsd: 0.072, costUnit: "per_second", pricingGroup: "seedance1lite", variantKey: "1080p" },
  // Veo (per second).
  veo_720p_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "veo", variantKey: "720p" },
  veo_1080p_per_second: { providerCostUsd: 0.08, costUnit: "per_second", pricingGroup: "veo", variantKey: "1080p" },
  // Veo 3.1 Fast (google/veo-3.1-fast, Text to Video). Priced by AUDIO, not
  // resolution: with audio costs more than without.
  veo31fast_with_audio_per_second: { providerCostUsd: 0.15, costUnit: "per_second", pricingGroup: "veo31fast", variantKey: "with_audio" },
  veo31fast_without_audio_per_second: { providerCostUsd: 0.10, costUnit: "per_second", pricingGroup: "veo31fast", variantKey: "without_audio" },
  // Veo 3.1 Lite (google/veo-3.1-lite, Text to Video). No audio; priced by
  // resolution. Note: 1080p only supports an 8s duration (enforced in the model).
  veo31lite_720p_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "veo31lite", variantKey: "720p" },
  veo31lite_1080p_per_second: { providerCostUsd: 0.08, costUnit: "per_second", pricingGroup: "veo31lite", variantKey: "1080p" },
  // Kling v3 (kwaivgi/kling-v3-video, Text to Video). Priced by mode
  // (standard=720p / pro=1080p / 4k) × audio. 4k is a flat rate regardless of audio.
  kling3_standard_per_second: { providerCostUsd: 0.168, costUnit: "per_second", pricingGroup: "kling3", variantKey: "standard" },
  kling3_standard_audio_per_second: { providerCostUsd: 0.252, costUnit: "per_second", pricingGroup: "kling3", variantKey: "standard_audio" },
  kling3_pro_per_second: { providerCostUsd: 0.224, costUnit: "per_second", pricingGroup: "kling3", variantKey: "pro" },
  kling3_pro_audio_per_second: { providerCostUsd: 0.336, costUnit: "per_second", pricingGroup: "kling3", variantKey: "pro_audio" },
  kling3_4k_per_second: { providerCostUsd: 0.42, costUnit: "per_second", pricingGroup: "kling3", variantKey: "4k" },
  // Kling v1.5 Standard (kwaivgi/kling-v1.5-standard) — flat per-second, i2v only.
  kling15_standard_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "kling15", variantKey: "standard" },
  kling15_pro_per_second: { providerCostUsd: 0.095, costUnit: "per_second", pricingGroup: "kling15", variantKey: "pro" },
  kling16_standard_per_second: { providerCostUsd: 0.05, costUnit: "per_second", pricingGroup: "kling16", variantKey: "standard" },
  kling16_pro_per_second: { providerCostUsd: 0.095, costUnit: "per_second", pricingGroup: "kling16", variantKey: "pro" },
  kling20_per_second: { providerCostUsd: 0.28, costUnit: "per_second", pricingGroup: "kling20", variantKey: "default" },
  // Kling v3 Motion Control (kwaivgi/kling-v3-motion-control). Priced by mode
  // (std=720p / pro=1080p). Output duration follows the reference video.
  kling3mc_std_per_second: { providerCostUsd: 0.07, costUnit: "per_second", pricingGroup: "kling3mc", variantKey: "std" },
  kling3mc_pro_per_second: { providerCostUsd: 0.12, costUnit: "per_second", pricingGroup: "kling3mc", variantKey: "pro" },
  // Storyboard image / GPT Image 2 (per image).
  storyboard_gpt_image_2_low_per_image: { providerCostUsd: 0.012, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "low" },
  storyboard_gpt_image_2_medium_per_image: { providerCostUsd: 0.047, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "medium" },
  storyboard_gpt_image_2_auto_per_image: { providerCostUsd: 0.128, costUnit: "per_image", pricingGroup: "storyboard_image", variantKey: "auto" },
  // Storyboard import — GPT-5 vision analysis of a user-UPLOADED storyboard sheet
  // to synthesize the seedance_prompt. No image is generated (cheaper than a
  // storyboard image render). Charged once per analyzed sheet. ~0.033 USD → 3 cr
  // at the current billing knobs (factor 90).
  storyboard_import_vision_per_image: { providerCostUsd: 0.033, costUnit: "per_image", pricingGroup: "storyboard_import", variantKey: "vision" },
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
