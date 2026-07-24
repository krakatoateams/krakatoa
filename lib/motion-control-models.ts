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

export const MOTION_CONTROL_MODEL_REGISTRY: MotionControlModel[] = [
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

/** Kling-only; cheapest std tier first ($0.07/s). */
const MOTION_CONTROL_SORT_ORDER: MotionControlModelId[] = [
  "kling26_motion",
  "kling_v3_motion",
];

const MOTION_CONTROL_BY_ID = Object.fromEntries(
  MOTION_CONTROL_MODEL_REGISTRY.map((m) => [m.id, m])
) as Record<MotionControlModelId, MotionControlModel>;

export const MOTION_CONTROL_MODELS: MotionControlModel[] = MOTION_CONTROL_SORT_ORDER.map(
  (id) => MOTION_CONTROL_BY_ID[id]
);

const MODEL_BY_ID = MOTION_CONTROL_BY_ID;

type VideoCreditsFn = (pricingKey: string, durationSec: number) => number;

/** Per-second tiers × duration; `5+` when std/pro modes differ. */
export function formatMotionControlModelCreditHint(
  model: MotionControlModel,
  videoCredits: VideoCreditsFn,
  durationSec = 5
): string {
  let min = Infinity;
  let max = 0;
  for (const mode of model.modes) {
    const cr = videoCredits(model.pricingKey(mode), durationSec);
    if (cr < min) min = cr;
    if (cr > max) max = cr;
  }
  return min === max ? String(min) : `${min}+`;
}

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

/** Kling rejects reference videos at exactly 10.0s for image orientation (strict < 10). */
export const MOTION_CONTROL_IMAGE_MAX_REF_SEC = 10;

/** Human-readable motion-clip length for the selected orientation (provider-safe). */
export function motionControlRefDurationRangeLabel(orientation: CharacterOrientation): string {
  return orientation === "image" ? "3–9s" : "3–30s";
}

export function motionControlRefVideoDurationError(
  durationSec: number | null | undefined,
  orientation: CharacterOrientation,
): string | null {
  const min = 3;
  const max = orientation === "video" ? 30 : MOTION_CONTROL_IMAGE_MAX_REF_SEC;
  if (durationSec == null || !Number.isFinite(durationSec)) return null;
  if (durationSec < min) {
    return `Motion clip must be at least ${min} seconds (yours is ${durationSec.toFixed(1)}s).`;
  }
  if (orientation === "image" && durationSec >= max) {
    return `Photo angle allows motion clips under 10 seconds — use 9s or less to be safe (yours is ${durationSec.toFixed(1)}s). Switch to Follow motion for clips up to 30s, or trim the video.`;
  }
  if (orientation === "video" && durationSec > max) {
    return `Follow motion allows motion clips up to ${max} seconds (yours is ${durationSec.toFixed(1)}s). Trim the video or pick a shorter clip.`;
  }
  return null;
}

/** Chip trigger label for character_orientation (image = photo angle, video = follow clip). */
export function characterOrientationChipLabel(orientation: CharacterOrientation): string {
  return orientation === "image" ? "Photo angle · 3–9s" : "Follow motion · 3–30s";
}

/** Menu row label (slightly longer than the chip). */
export function characterOrientationMenuLabel(orientation: CharacterOrientation): string {
  return orientation === "image" ? "Photo angle" : "Follow motion";
}

/** Short hint beside each menu option — includes duration limits. */
export function characterOrientationMenuHint(orientation: CharacterOrientation): string {
  return orientation === "image"
    ? "Face like your photo · motion clip 3–9s"
    : "Turns like the clip · motion clip 3–30s";
}

/** Hover tooltip on the orientation chip. */
export const CHARACTER_ORIENTATION_TOOLTIP =
  "Photo angle: character faces like your photo — motion clip 3–9s (provider max 10s; exactly 10s often fails). Follow motion: character moves like the clip — motion clip 3–30s. Use Follow motion for dance, tai chi, or any clip around 10s+.";

/** Hover tooltip on the quality (mode) chip. */
export const MOTION_CONTROL_QUALITY_TOOLTIP =
  "Output sharpness. Standard is 720p and costs less. Pro is 1080p, sharper, and uses more credits.";

/** RefGroup hint for the motion reference video upload. */
export function motionControlVideoHint(params: {
  refDurationSec: number | null;
  billedDurationSec: number;
  orientation: CharacterOrientation;
}): string {
  const limit = motionControlRefDurationRangeLabel(params.orientation);
  const modeLabel = params.orientation === "image" ? "Photo angle" : "Follow motion";
  if (params.refDurationSec != null) {
    return `Movement to copy (dance, walk, gestures). Yours: ${params.refDurationSec.toFixed(1)}s · billed ${params.billedDurationSec}s. With ${modeLabel}, keep the clip within ${limit}. MP4 or MOV, max 100 MB.`;
  }
  return `Movement to copy — your character performs these actions. Photo angle: motion clip 3–9s. Follow motion: motion clip 3–30s. MP4 or MOV, max 100 MB.`;
}

/** PhotoLibraryPicker hint for the character image. */
export const MOTION_CONTROL_CHARACTER_HINT =
  "Photo of the person you want to animate. Their appearance in the result comes from this image. Clear face and body. JPG or PNG, max 10 MB.";

/** Advanced prompt placeholder — motion always comes from the reference video. */
export const MOTION_CONTROL_PROMPT_PLACEHOLDER =
  'Optional—describe the scene or add details, e.g. "in a snowy park" or "wearing a red jacket". Movement always comes from your motion video.';

/** Tooltip for the original-sound toggle. */
export function motionControlSoundTooltip(keep: boolean): string {
  return keep
    ? "On — the sound from your motion video is included. Click to remove it."
    : "Off — your result is silent. Click to keep the motion video's sound.";
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
  const billed = Math.min(Math.max(Math.round(raw), params.model.minDurationSec), cap);
  // Image orientation: provider rejects duration >= 10s — bill at most 9s when at the limit.
  if (params.orientation === "image" && billed >= MOTION_CONTROL_IMAGE_MAX_REF_SEC) {
    return MOTION_CONTROL_IMAGE_MAX_REF_SEC - 1;
  }
  return billed;
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
