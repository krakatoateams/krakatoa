import {
  INITIAL_DUMMY_CREDITS,
  PRODUCT_PHOTO_CREDITS,
  STORYBOARD_IMAGE_CREDITS,
  STORYBOARD_VIDEO_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
} from "@/lib/credit-costs";
import type { CostUnit, PricingType } from "@/lib/pricing-configs-db";

/**
 * Canonical reset-to-default values for the Admin Config panel (Admin Phase 2.5).
 *
 * This is the single source of truth used by the `/reset` endpoints to restore a
 * row to its shipped default. It intentionally does NOT change runtime behavior:
 *
 *   THREE DEFINITIONS MUST STAY ALIGNED whenever a default changes:
 *     1. SQL seed         — supabase/migrations/007_admin_panel.sql (6b-6d) +
 *                           supabase/migrations/009_pricing_config_v2.sql (v2 rows)
 *     2. Runtime fallback — lib/credit-costs.ts (pricing) + lib/model-resolver.ts FALLBACKS (models)
 *     3. Reset defaults   — this file
 *
 * Pricing amounts are imported from lib/credit-costs.ts so the numbers are never
 * duplicated. Model/tool defaults mirror the seed rows verbatim. Whisper stores
 * its pinned version in parameters.version (DB-seed shape) — NOT the resolver's
 * combined "model:version" string — so a reset writes exactly what the seed did.
 */

export type PricingDefault = {
  pricing_type: PricingType;
  credit_amount: number;
  enabled: boolean;
  // Pricing Config v2.1 (present only on v2 rows; legacy rows omit these).
  provider_cost_usd?: number | null;
  cost_unit?: CostUnit | null;
  pricing_group?: string | null;
  variant_key?: string | null;
  currency?: string;
};

export type ModelDefault = {
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
  is_default: boolean;
};

export type ToolDefault = {
  display_name: string;
  enabled: boolean;
  visible_in_sidebar: boolean;
  sort_order: number;
};

const WHISPER_VERSION =
  "3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";

/**
 * Reset defaults keyed by pricing_key. Legacy rows (seed 007 6c) take amounts from
 * lib/credit-costs.ts; v2 rows (migration 009) carry provider_cost_usd + cost_unit
 * and a legacy credit_amount fallback, mirroring the 009 seed verbatim.
 */
export const PRICING_DEFAULTS: Record<string, PricingDefault> = {
  // ---- Platform credit grant (007) — NOT a generation price ----
  initial_dummy_credits: {
    pricing_type: "fixed",
    credit_amount: INITIAL_DUMMY_CREDITS,
    enabled: true,
  },
  // ---- Deprecated legacy generation rows (v2.2, migration 010) ----
  // Soft-deprecated + disabled: superseded by the v2 provider-cost rows below and
  // never read by the runtime resolver. Defaults keep them disabled so a reset
  // does not re-activate a confusing legacy price.
  product_photo: {
    pricing_type: "per_image",
    credit_amount: PRODUCT_PHOTO_CREDITS,
    enabled: false,
  },
  storyboard_image: {
    pricing_type: "per_image",
    credit_amount: STORYBOARD_IMAGE_CREDITS,
    enabled: false,
  },
  storyboard_video: {
    pricing_type: "fixed",
    credit_amount: STORYBOARD_VIDEO_CREDITS,
    enabled: false,
  },
  seedance_video_per_second: {
    pricing_type: "per_second",
    credit_amount: VIDEO_CREDITS_PER_SECOND,
    enabled: false,
  },
  veo_video_per_second: {
    pricing_type: "per_second",
    credit_amount: VIDEO_CREDITS_PER_SECOND,
    enabled: false,
  },
  // ---- v2 provider-cost rows (009). credit_amount is fallback only. ----
  seedance_480p_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.07, cost_unit: "per_second", pricing_group: "seedance", variant_key: "480p", currency: "USD",
  },
  seedance_720p_per_second: {
    pricing_type: "per_second", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.15, cost_unit: "per_second", pricing_group: "seedance", variant_key: "720p", currency: "USD",
  },
  // Seedance "video_in" variant (a reference video is provided) — pricier tier
  // (migration 014). Used by Text to Video when a reference video is attached.
  seedance_480p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 8, enabled: true,
    provider_cost_usd: 0.08, cost_unit: "per_second", pricing_group: "seedance", variant_key: "480p_video_in", currency: "USD",
  },
  seedance_720p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 16, enabled: true,
    provider_cost_usd: 0.17, cost_unit: "per_second", pricing_group: "seedance", variant_key: "720p_video_in", currency: "USD",
  },
  // ---- Seedance 2.0 (full, bytedance/seedance-2.0) rows (015). Pricier than the
  // Fast variant and adds a 1080p tier. non_video_in (no reference video). ----
  seedance2_480p_per_second: {
    pricing_type: "per_second", credit_amount: 8, enabled: true,
    provider_cost_usd: 0.08, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "480p", currency: "USD",
  },
  seedance2_720p_per_second: {
    pricing_type: "per_second", credit_amount: 17, enabled: true,
    provider_cost_usd: 0.18, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "720p", currency: "USD",
  },
  seedance2_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 41, enabled: true,
    provider_cost_usd: 0.45, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "1080p", currency: "USD",
  },
  // Seedance 2.0 (full) — video_in (a reference video is provided).
  seedance2_480p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 9, enabled: true,
    provider_cost_usd: 0.10, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "480p_video_in", currency: "USD",
  },
  seedance2_720p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 20, enabled: true,
    provider_cost_usd: 0.22, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "720p_video_in", currency: "USD",
  },
  seedance2_1080p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 50, enabled: true,
    provider_cost_usd: 0.55, cost_unit: "per_second", pricing_group: "seedance2", variant_key: "1080p_video_in", currency: "USD",
  },
  // ---- Seedance 2.0 Mini (bytedance/seedance-2.0-mini) rows (025). Storyboard +
  // Text to Video. non_video_in / video_in at 480p & 720p only. ----
  seedance2mini_480p_per_second: {
    pricing_type: "per_second", credit_amount: 4, enabled: true,
    provider_cost_usd: 0.04, cost_unit: "per_second", pricing_group: "seedance2mini", variant_key: "480p", currency: "USD",
  },
  seedance2mini_720p_per_second: {
    pricing_type: "per_second", credit_amount: 9, enabled: true,
    provider_cost_usd: 0.09, cost_unit: "per_second", pricing_group: "seedance2mini", variant_key: "720p", currency: "USD",
  },
  seedance2mini_480p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "seedance2mini", variant_key: "480p_video_in", currency: "USD",
  },
  seedance2mini_720p_video_in_per_second: {
    pricing_type: "per_second", credit_amount: 10, enabled: true,
    provider_cost_usd: 0.11, cost_unit: "per_second", pricing_group: "seedance2mini", variant_key: "720p_video_in", currency: "USD",
  },
  // ---- Seedance 1.5 Pro (bytedance/seedance-1.5-pro) rows (026). Text to Video.
  // Priced by resolution × audio. ----
  seedance15_480p_with_audio_per_second: {
    pricing_type: "per_second", credit_amount: 3, enabled: true,
    provider_cost_usd: 0.025, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "480p_with_audio", currency: "USD",
  },
  seedance15_720p_with_audio_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.052, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "720p_with_audio", currency: "USD",
  },
  seedance15_1080p_with_audio_per_second: {
    pricing_type: "per_second", credit_amount: 11, enabled: true,
    provider_cost_usd: 0.12, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "1080p_with_audio", currency: "USD",
  },
  seedance15_480p_without_audio_per_second: {
    pricing_type: "per_second", credit_amount: 2, enabled: true,
    provider_cost_usd: 0.013, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "480p_without_audio", currency: "USD",
  },
  seedance15_720p_without_audio_per_second: {
    pricing_type: "per_second", credit_amount: 3, enabled: true,
    provider_cost_usd: 0.026, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "720p_without_audio", currency: "USD",
  },
  seedance15_1080p_without_audio_per_second: {
    pricing_type: "per_second", credit_amount: 6, enabled: true,
    provider_cost_usd: 0.06, cost_unit: "per_second", pricing_group: "seedance15", variant_key: "1080p_without_audio", currency: "USD",
  },
  // ---- Seedance 1 Pro Fast (bytedance/seedance-1-pro-fast) rows (027). Text to
  // Video; priced by resolution only (no audio). ----
  seedance1fast_480p_per_second: {
    pricing_type: "per_second", credit_amount: 2, enabled: true,
    provider_cost_usd: 0.015, cost_unit: "per_second", pricing_group: "seedance1fast", variant_key: "480p", currency: "USD",
  },
  seedance1fast_720p_per_second: {
    pricing_type: "per_second", credit_amount: 3, enabled: true,
    provider_cost_usd: 0.025, cost_unit: "per_second", pricing_group: "seedance1fast", variant_key: "720p", currency: "USD",
  },
  seedance1fast_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 6, enabled: true,
    provider_cost_usd: 0.06, cost_unit: "per_second", pricing_group: "seedance1fast", variant_key: "1080p", currency: "USD",
  },
  // ---- Seedance 1 Pro (bytedance/seedance-1-pro) rows (028). Text to Video;
  // priced by resolution only (no audio). ----
  seedance1pro_480p_per_second: {
    pricing_type: "per_second", credit_amount: 3, enabled: true,
    provider_cost_usd: 0.03, cost_unit: "per_second", pricing_group: "seedance1pro", variant_key: "480p", currency: "USD",
  },
  seedance1pro_720p_per_second: {
    pricing_type: "per_second", credit_amount: 6, enabled: true,
    provider_cost_usd: 0.06, cost_unit: "per_second", pricing_group: "seedance1pro", variant_key: "720p", currency: "USD",
  },
  seedance1pro_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.15, cost_unit: "per_second", pricing_group: "seedance1pro", variant_key: "1080p", currency: "USD",
  },
  // ---- Seedance 1 Lite (bytedance/seedance-1-lite) rows (029). Text to Video;
  // priced by resolution only (no audio). ----
  seedance1lite_480p_per_second: {
    pricing_type: "per_second", credit_amount: 2, enabled: true,
    provider_cost_usd: 0.018, cost_unit: "per_second", pricing_group: "seedance1lite", variant_key: "480p", currency: "USD",
  },
  seedance1lite_720p_per_second: {
    pricing_type: "per_second", credit_amount: 4, enabled: true,
    provider_cost_usd: 0.036, cost_unit: "per_second", pricing_group: "seedance1lite", variant_key: "720p", currency: "USD",
  },
  seedance1lite_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.072, cost_unit: "per_second", pricing_group: "seedance1lite", variant_key: "1080p", currency: "USD",
  },
  veo_720p_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "veo", variant_key: "720p", currency: "USD",
  },
  veo_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 8, enabled: true,
    provider_cost_usd: 0.08, cost_unit: "per_second", pricing_group: "veo", variant_key: "1080p", currency: "USD",
  },
  // ---- Veo 3.1 Fast (google/veo-3.1-fast, Text to Video) rows (016). Priced by
  // AUDIO, not resolution. ----
  veo31fast_with_audio_per_second: {
    pricing_type: "per_second", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.15, cost_unit: "per_second", pricing_group: "veo31fast", variant_key: "with_audio", currency: "USD",
  },
  veo31fast_without_audio_per_second: {
    pricing_type: "per_second", credit_amount: 9, enabled: true,
    provider_cost_usd: 0.10, cost_unit: "per_second", pricing_group: "veo31fast", variant_key: "without_audio", currency: "USD",
  },
  // ---- Veo 3.1 Lite (google/veo-3.1-lite, Text to Video) rows (017). No audio;
  // priced by resolution. ----
  veo31lite_720p_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "veo31lite", variant_key: "720p", currency: "USD",
  },
  veo31lite_1080p_per_second: {
    pricing_type: "per_second", credit_amount: 8, enabled: true,
    provider_cost_usd: 0.08, cost_unit: "per_second", pricing_group: "veo31lite", variant_key: "1080p", currency: "USD",
  },
  // ---- Kling v3 (kwaivgi/kling-v3-video, Text to Video) rows (018). Priced by
  // mode (standard=720p / pro=1080p / 4k) × audio. 4k is flat regardless of audio. ----
  kling3_standard_per_second: {
    pricing_type: "per_second", credit_amount: 16, enabled: true,
    provider_cost_usd: 0.168, cost_unit: "per_second", pricing_group: "kling3", variant_key: "standard", currency: "USD",
  },
  kling3_standard_audio_per_second: {
    pricing_type: "per_second", credit_amount: 23, enabled: true,
    provider_cost_usd: 0.252, cost_unit: "per_second", pricing_group: "kling3", variant_key: "standard_audio", currency: "USD",
  },
  kling3_pro_per_second: {
    pricing_type: "per_second", credit_amount: 21, enabled: true,
    provider_cost_usd: 0.224, cost_unit: "per_second", pricing_group: "kling3", variant_key: "pro", currency: "USD",
  },
  kling3_pro_audio_per_second: {
    pricing_type: "per_second", credit_amount: 31, enabled: true,
    provider_cost_usd: 0.336, cost_unit: "per_second", pricing_group: "kling3", variant_key: "pro_audio", currency: "USD",
  },
  kling3_4k_per_second: {
    pricing_type: "per_second", credit_amount: 38, enabled: true,
    provider_cost_usd: 0.42, cost_unit: "per_second", pricing_group: "kling3", variant_key: "4k", currency: "USD",
  },
  kling3omni_standard_per_second: {
    pricing_type: "per_second", credit_amount: 17, enabled: true,
    provider_cost_usd: 0.168, cost_unit: "per_second", pricing_group: "kling3omni", variant_key: "standard", currency: "USD",
  },
  kling3omni_standard_audio_per_second: {
    pricing_type: "per_second", credit_amount: 22, enabled: true,
    provider_cost_usd: 0.224, cost_unit: "per_second", pricing_group: "kling3omni", variant_key: "standard_audio", currency: "USD",
  },
  kling3omni_pro_per_second: {
    pricing_type: "per_second", credit_amount: 22, enabled: true,
    provider_cost_usd: 0.224, cost_unit: "per_second", pricing_group: "kling3omni", variant_key: "pro", currency: "USD",
  },
  kling3omni_pro_audio_per_second: {
    pricing_type: "per_second", credit_amount: 28, enabled: true,
    provider_cost_usd: 0.28, cost_unit: "per_second", pricing_group: "kling3omni", variant_key: "pro_audio", currency: "USD",
  },
  kling3omni_4k_per_second: {
    pricing_type: "per_second", credit_amount: 42, enabled: true,
    provider_cost_usd: 0.42, cost_unit: "per_second", pricing_group: "kling3omni", variant_key: "4k", currency: "USD",
  },
  // ---- Kling v1.5 Standard (kwaivgi/kling-v1.5-standard) rows (030). Flat per-second. ----
  kling15_standard_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "kling15", variant_key: "standard", currency: "USD",
  },
  kling15_pro_per_second: {
    pricing_type: "per_second", credit_amount: 10, enabled: true,
    provider_cost_usd: 0.095, cost_unit: "per_second", pricing_group: "kling15", variant_key: "pro", currency: "USD",
  },
  kling16_standard_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "kling16", variant_key: "standard", currency: "USD",
  },
  kling16_pro_per_second: {
    pricing_type: "per_second", credit_amount: 10, enabled: true,
    provider_cost_usd: 0.095, cost_unit: "per_second", pricing_group: "kling16", variant_key: "pro", currency: "USD",
  },
  kling20_per_second: {
    pricing_type: "per_second", credit_amount: 28, enabled: true,
    provider_cost_usd: 0.28, cost_unit: "per_second", pricing_group: "kling20", variant_key: "default", currency: "USD",
  },
  kling21_standard_per_second: {
    pricing_type: "per_second", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.05, cost_unit: "per_second", pricing_group: "kling21", variant_key: "standard", currency: "USD",
  },
  kling21_pro_per_second: {
    pricing_type: "per_second", credit_amount: 9, enabled: true,
    provider_cost_usd: 0.09, cost_unit: "per_second", pricing_group: "kling21", variant_key: "pro", currency: "USD",
  },
  kling25turbo_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.07, cost_unit: "per_second", pricing_group: "kling25turbo", variant_key: "default", currency: "USD",
  },
  kling26_without_audio_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.07, cost_unit: "per_second", pricing_group: "kling26", variant_key: "without_audio", currency: "USD",
  },
  kling26_with_audio_per_second: {
    pricing_type: "per_second", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.14, cost_unit: "per_second", pricing_group: "kling26", variant_key: "with_audio", currency: "USD",
  },
  // ---- Kling v3 Motion Control (kwaivgi/kling-v3-motion-control) rows (019).
  // Priced by mode (std=720p / pro=1080p). Duration follows the reference video. ----
  kling3mc_std_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.07, cost_unit: "per_second", pricing_group: "kling3mc", variant_key: "std", currency: "USD",
  },
  kling3mc_pro_per_second: {
    pricing_type: "per_second", credit_amount: 11, enabled: true,
    provider_cost_usd: 0.12, cost_unit: "per_second", pricing_group: "kling3mc", variant_key: "pro", currency: "USD",
  },
  kling26mc_std_per_second: {
    pricing_type: "per_second", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.07, cost_unit: "per_second", pricing_group: "kling26mc", variant_key: "std", currency: "USD",
  },
  kling26mc_pro_per_second: {
    pricing_type: "per_second", credit_amount: 11, enabled: true,
    provider_cost_usd: 0.12, cost_unit: "per_second", pricing_group: "kling26mc", variant_key: "pro", currency: "USD",
  },
  storyboard_gpt_image_2_low_per_image: {
    pricing_type: "per_image", credit_amount: 2, enabled: true,
    provider_cost_usd: 0.012, cost_unit: "per_image", pricing_group: "storyboard_image", variant_key: "low", currency: "USD",
  },
  storyboard_gpt_image_2_medium_per_image: {
    pricing_type: "per_image", credit_amount: 5, enabled: true,
    provider_cost_usd: 0.047, cost_unit: "per_image", pricing_group: "storyboard_image", variant_key: "medium", currency: "USD",
  },
  storyboard_gpt_image_2_auto_per_image: {
    pricing_type: "per_image", credit_amount: 12, enabled: true,
    provider_cost_usd: 0.128, cost_unit: "per_image", pricing_group: "storyboard_image", variant_key: "auto", currency: "USD",
  },
  // ---- Deprecated ambiguous Product Photo v2 rows (v2.3, migration 011) ----
  // Superseded by the model-tier rows below (the previous 1k/2k/4k keys assumed
  // Nano Banana Pro but the app actually ran plain google/nano-banana). Disabled
  // so a reset never re-activates an ambiguous price; runtime no longer reads them.
  product_photo_fallback_per_image: {
    pricing_type: "per_image", credit_amount: 4, enabled: false,
    provider_cost_usd: 0.035, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "fallback", currency: "USD",
  },
  product_photo_1k_per_image: {
    pricing_type: "per_image", credit_amount: 14, enabled: false,
    provider_cost_usd: 0.15, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "1k", currency: "USD",
  },
  product_photo_2k_per_image: {
    pricing_type: "per_image", credit_amount: 14, enabled: false,
    provider_cost_usd: 0.15, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "2k", currency: "USD",
  },
  product_photo_4k_per_image: {
    pricing_type: "per_image", credit_amount: 27, enabled: false,
    provider_cost_usd: 0.30, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "4k", currency: "USD",
  },
  // ---- Product Photo model tiers (v2.3, migration 011). credit_amount fallback. ----
  product_photo_nano_banana_per_image: {
    pricing_type: "per_image", credit_amount: 4, enabled: true,
    provider_cost_usd: 0.039, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "basic", currency: "USD",
  },
  product_photo_nano_banana_2_1k_per_image: {
    pricing_type: "per_image", credit_amount: 7, enabled: true,
    provider_cost_usd: 0.067, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "balanced_1k", currency: "USD",
  },
  product_photo_nano_banana_2_2k_per_image: {
    pricing_type: "per_image", credit_amount: 10, enabled: true,
    provider_cost_usd: 0.101, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "balanced_2k", currency: "USD",
  },
  product_photo_nano_banana_2_4k_per_image: {
    pricing_type: "per_image", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.151, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "balanced_4k", currency: "USD",
  },
  product_photo_nano_banana_pro_1k_per_image: {
    pricing_type: "per_image", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.15, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "pro_1k", currency: "USD",
  },
  product_photo_nano_banana_pro_2k_per_image: {
    pricing_type: "per_image", credit_amount: 14, enabled: true,
    provider_cost_usd: 0.15, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "pro_2k", currency: "USD",
  },
  product_photo_nano_banana_pro_4k_per_image: {
    pricing_type: "per_image", credit_amount: 27, enabled: true,
    provider_cost_usd: 0.30, cost_unit: "per_image", pricing_group: "product_photo", variant_key: "pro_4k", currency: "USD",
  },
};

/** Reset defaults keyed by `${tool_key}.${config_key}` (mirrors seed 6d). */
export const MODEL_DEFAULTS: Record<string, ModelDefault> = {
  "reels.llm": { provider: "replicate", model: "google/gemini-2.5-flash", parameters: {}, enabled: true, is_default: true },
  "reels.video": { provider: "replicate", model: "bytedance/seedance-2.0-fast", parameters: {}, enabled: true, is_default: true },
  "reels.tts": { provider: "replicate", model: "minimax/speech-02-turbo", parameters: {}, enabled: true, is_default: true },
  "reels.whisper": { provider: "replicate", model: "vaibhavs10/incredibly-fast-whisper", parameters: { version: WHISPER_VERSION }, enabled: true, is_default: true },
  "veo.llm": { provider: "replicate", model: "google/gemini-2.5-flash", parameters: {}, enabled: true, is_default: true },
  "veo.video": { provider: "replicate", model: "google/veo-3.1-lite", parameters: {}, enabled: true, is_default: true },
  "veo.tts": { provider: "replicate", model: "minimax/speech-02-turbo", parameters: {}, enabled: true, is_default: true },
  "veo.whisper": { provider: "replicate", model: "vaibhavs10/incredibly-fast-whisper", parameters: { version: WHISPER_VERSION }, enabled: true, is_default: true },
  "storyboard.scene_llm": { provider: "replicate", model: "openai/gpt-5", parameters: {}, enabled: true, is_default: true },
  "storyboard.image": { provider: "replicate", model: "openai/gpt-image-2", parameters: {}, enabled: true, is_default: true },
  "storyboard.video": { provider: "replicate", model: "bytedance/seedance-2.0-mini", parameters: {}, enabled: true, is_default: true },
  "reels.video_seedance2_mini": { provider: "replicate", model: "bytedance/seedance-2.0-mini", parameters: {}, enabled: true, is_default: true },
  "reels.video_seedance15_pro": { provider: "replicate", model: "bytedance/seedance-1.5-pro", parameters: {}, enabled: true, is_default: true },
  "reels.video_seedance1_pro_fast": { provider: "replicate", model: "bytedance/seedance-1-pro-fast", parameters: {}, enabled: true, is_default: true },
  "reels.video_seedance1_pro": { provider: "replicate", model: "bytedance/seedance-1-pro", parameters: {}, enabled: true, is_default: true },
  "reels.video_seedance1_lite": { provider: "replicate", model: "bytedance/seedance-1-lite", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling21": { provider: "replicate", model: "kwaivgi/kling-v2.1", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling25_turbo_pro": { provider: "replicate", model: "kwaivgi/kling-v2.5-turbo-pro", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling_v3_omni": { provider: "replicate", model: "kwaivgi/kling-v3-omni-video", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling26": { provider: "replicate", model: "kwaivgi/kling-v2.6", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling26_motion": { provider: "replicate", model: "kwaivgi/kling-v2.6-motion-control", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling20": { provider: "replicate", model: "kwaivgi/kling-v2.0", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling16_pro": { provider: "replicate", model: "kwaivgi/kling-v1.6-pro", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling16_standard": { provider: "replicate", model: "kwaivgi/kling-v1.6-standard", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling15_standard": { provider: "replicate", model: "kwaivgi/kling-v1.5-standard", parameters: {}, enabled: true, is_default: true },
  "reels.video_kling15_pro": { provider: "replicate", model: "kwaivgi/kling-v1.5-pro", parameters: {}, enabled: true, is_default: true },
  // Legacy single Product Photo model role — disabled/deprecated in migration 011
  // (replaced by the per-tier roles below). Reset keeps it disabled.
  "photo.image": { provider: "replicate", model: "google/nano-banana", parameters: {}, enabled: false, is_default: true },
  "photo.image_basic": { provider: "replicate", model: "google/nano-banana", parameters: {}, enabled: true, is_default: true },
  "photo.image_balanced": { provider: "replicate", model: "google/nano-banana-2", parameters: {}, enabled: true, is_default: true },
  "photo.image_pro": { provider: "replicate", model: "google/nano-banana-pro", parameters: {}, enabled: true, is_default: true },
  "render.rendi": { provider: "rendi", model: "default", parameters: {}, enabled: true, is_default: true },
};

/** Reset defaults keyed by tool_key (mirrors seed 6b). */
export const TOOL_DEFAULTS: Record<string, ToolDefault> = {
  dashboard: { display_name: "Dashboard", enabled: true, visible_in_sidebar: true, sort_order: 0 },
  reels: { display_name: "ReelsGen", enabled: true, visible_in_sidebar: true, sort_order: 1 },
  photo: { display_name: "Product Photo", enabled: true, visible_in_sidebar: true, sort_order: 2 },
  ig: { display_name: "IG Automation", enabled: true, visible_in_sidebar: true, sort_order: 3 },
  schedule: { display_name: "Schedule", enabled: true, visible_in_sidebar: true, sort_order: 4 },
  calendar: { display_name: "Calendar", enabled: true, visible_in_sidebar: true, sort_order: 5 },
};

export function getPricingDefault(pricingKey: string): PricingDefault | null {
  return PRICING_DEFAULTS[pricingKey] ?? null;
}

export function getModelDefault(toolKey: string, configKey: string): ModelDefault | null {
  return MODEL_DEFAULTS[`${toolKey}.${configKey}`] ?? null;
}

export function getToolDefault(toolKey: string): ToolDefault | null {
  return TOOL_DEFAULTS[toolKey] ?? null;
}
