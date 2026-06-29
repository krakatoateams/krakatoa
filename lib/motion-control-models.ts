import { klingV3MotionControlPricingKey, kling26MotionControlPricingKey } from "@/lib/pricing-math";

/**
 * Motion Control model registry (Text to Video → Motion Control sub-tool).
 *
 * Motion Control is a distinct generation shape from Text to Video: it REQUIRES a
 * reference image (the character) and a reference video (the motion to copy), and
 * the output clip length follows the reference video (not a user-picked duration).
 * Because the input/billing shape differs so much from VIDEO_MODELS, it lives in
 * its own small registry. Adding a model later = one entry here + a builder branch.
 *
 * Starter scope: Kling v3 Motion Control (kwaivgi/kling-v3-motion-control).
 */

export type MotionControlModelId = "kling_v3_motion" | "kling26_motion";

/** Provider quality mode. std = 720p (cheaper), pro = 1080p. */
export type MotionControlMode = "std" | "pro";

/**
 * Where the generated character's orientation comes from:
 *  - "image": match the person in the reference image (clip capped at 10s).
 *  - "video": match the characters in the reference video (clip up to 30s).
 */
export type CharacterOrientation = "image" | "video";

export type MotionControlModel = {
  id: MotionControlModelId;
  label: string;
  modelLabel: string;
  /** model_configs config_key (under tool_key "reels") used by the resolver. */
  modelRole: string;
  providerModel: `${string}/${string}`;
  modes: MotionControlMode[];
  defaultMode: MotionControlMode;
  defaultKeepOriginalSound: boolean;
  defaultOrientation: CharacterOrientation;
  /** Minimum reference video length the provider accepts (seconds). */
  minDurationSec: number;
  /** Max output length for an orientation (seconds). */
  maxDurationForOrientation: (orientation: CharacterOrientation) => number;
  promptMaxChars: number;
  /** Per-second pricing key for a mode. */
  pricingKey: (mode: MotionControlMode) => string;
};

export const MOTION_CONTROL_MODELS: MotionControlModel[] = [
  {
    id: "kling_v3_motion",
    label: "Kling v3 Motion Control",
    modelLabel: "Kling v3 Motion Control",
    modelRole: "video_kling_v3_motion",
    providerModel: "kwaivgi/kling-v3-motion-control",
    modes: ["std", "pro"],
    defaultMode: "pro",
    defaultKeepOriginalSound: true,
    defaultOrientation: "image",
    minDurationSec: 3,
    // "image" orientation caps the clip at 10s; "video" allows up to 30s.
    maxDurationForOrientation: (orientation) => (orientation === "video" ? 30 : 10),
    promptMaxChars: 2500,
    pricingKey: (mode) => klingV3MotionControlPricingKey(mode),
  },
  {
    id: "kling26_motion",
    label: "Kling v2.6 Motion Control",
    modelLabel: "Kling v2.6 Motion Control",
    modelRole: "video_kling26_motion",
    providerModel: "kwaivgi/kling-v2.6-motion-control",
    modes: ["std", "pro"],
    defaultMode: "std",
    defaultKeepOriginalSound: true,
    defaultOrientation: "image",
    minDurationSec: 3,
    maxDurationForOrientation: (orientation) => (orientation === "video" ? 30 : 10),
    promptMaxChars: 2500,
    pricingKey: (mode) => kling26MotionControlPricingKey(mode),
  },
];

const MODEL_BY_ID = Object.fromEntries(
  MOTION_CONTROL_MODELS.map((m) => [m.id, m])
) as Record<MotionControlModelId, MotionControlModel>;

export const DEFAULT_MOTION_CONTROL_MODEL_ID: MotionControlModelId = "kling_v3_motion";

export function isValidMotionControlModelId(id: string): id is MotionControlModelId {
  return id in MODEL_BY_ID;
}

export function getMotionControlModel(id: string): MotionControlModel {
  return MODEL_BY_ID[id as MotionControlModelId] ?? MODEL_BY_ID[DEFAULT_MOTION_CONTROL_MODEL_ID];
}

export function isValidMotionControlMode(
  model: MotionControlModel,
  mode: string
): mode is MotionControlMode {
  return (model.modes as string[]).includes(mode);
}

export function isValidCharacterOrientation(orientation: string): orientation is CharacterOrientation {
  return orientation === "image" || orientation === "video";
}

/** std -> 720p, pro -> 1080p (for display + asset metadata). */
export function motionControlResolutionLabel(mode: MotionControlMode): string {
  return mode === "std" ? "720p" : "1080p";
}

/**
 * Effective billed output duration: the reference video length, clamped to the
 * model minimum and the orientation cap. Used by BOTH the client cost label and
 * the server billing so they agree.
 */
export function effectiveMotionControlDuration(params: {
  model: MotionControlModel;
  refVideoDurationSec: number | null | undefined;
  orientation: CharacterOrientation;
}): number {
  const cap = params.model.maxDurationForOrientation(params.orientation);
  const raw = params.refVideoDurationSec;
  // Unknown duration → assume the cap (conservative; never undercharge).
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return cap;
  return Math.min(Math.max(Math.round(raw), params.model.minDurationSec), cap);
}

/** Build the Replicate input for Kling Motion Control (v2.6 / v3 — same shape). */
export function buildMotionControlProviderInput(params: {
  prompt: string;
  mode: MotionControlMode;
  keepOriginalSound: boolean;
  characterOrientation: CharacterOrientation;
  imageUrl: string;
  videoUrl: string;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    image: params.imageUrl,
    video: params.videoUrl,
    mode: params.mode,
    keep_original_sound: params.keepOriginalSound,
    character_orientation: params.characterOrientation,
  };
  const prompt = params.prompt.trim();
  if (prompt) input.prompt = prompt;
  return input;
}
