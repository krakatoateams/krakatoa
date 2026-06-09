import {
  INITIAL_DUMMY_CREDITS,
  PRODUCT_PHOTO_CREDITS,
  STORYBOARD_IMAGE_CREDITS,
  STORYBOARD_VIDEO_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
} from "@/lib/credit-costs";
import type { PricingType } from "@/lib/pricing-configs-db";

/**
 * Canonical reset-to-default values for the Admin Config panel (Admin Phase 2.5).
 *
 * This is the single source of truth used by the `/reset` endpoints to restore a
 * row to its shipped default. It intentionally does NOT change runtime behavior:
 *
 *   THREE DEFINITIONS MUST STAY ALIGNED whenever a default changes:
 *     1. SQL seed         — supabase/migrations/007_admin_panel.sql (sections 6b-6d)
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

/** Reset defaults keyed by pricing_key (mirrors seed 6c; amounts from credit-costs). */
export const PRICING_DEFAULTS: Record<string, PricingDefault> = {
  initial_dummy_credits: {
    pricing_type: "fixed",
    credit_amount: INITIAL_DUMMY_CREDITS,
    enabled: true,
  },
  product_photo: {
    pricing_type: "per_image",
    credit_amount: PRODUCT_PHOTO_CREDITS,
    enabled: true,
  },
  storyboard_image: {
    pricing_type: "per_image",
    credit_amount: STORYBOARD_IMAGE_CREDITS,
    enabled: true,
  },
  storyboard_video: {
    pricing_type: "fixed",
    credit_amount: STORYBOARD_VIDEO_CREDITS,
    enabled: true,
  },
  seedance_video_per_second: {
    pricing_type: "per_second",
    credit_amount: VIDEO_CREDITS_PER_SECOND,
    enabled: true,
  },
  veo_video_per_second: {
    pricing_type: "per_second",
    credit_amount: VIDEO_CREDITS_PER_SECOND,
    enabled: true,
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
  "storyboard.video": { provider: "replicate", model: "bytedance/seedance-2.0-fast", parameters: {}, enabled: true, is_default: true },
  "photo.image": { provider: "replicate", model: "google/nano-banana", parameters: {}, enabled: true, is_default: true },
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
