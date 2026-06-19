import {
  seedanceFastPricingKey,
  seedance2PricingKey,
  veo31FastPricingKey,
} from "@/lib/pricing-math";

/**
 * Video model registry (Text to Video — omni-composer at /tools/video).
 *
 * Analogous to lib/product-photo.ts (PRODUCT_PHOTO_TIERS): each model declares
 * its provider id, the model_configs config_key used to resolve/override it, its
 * capability envelope (durations, resolutions, aspect ratios, audio, reference
 * slots), and the pricing key used by BOTH the client label and the server
 * billing. Adding a new video model later = adding an entry here + a per-family
 * branch in buildVideoProviderInput.
 *
 * Starter scope: Seedance 2 Fast only. It reuses the existing `reels.video`
 * model_configs row (admin-editable), whose fallback is bytedance/seedance-2.0-fast.
 */

export type VideoModelId = "seedance2_fast" | "seedance2" | "veo31_fast";

export type VideoResolution = "480p" | "720p" | "1080p";

export type VideoAspectRatio =
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "21:9"
  | "9:21"
  | "adaptive";

export type VideoProviderFamily = "seedance2" | "veo31fast";

/**
 * Inputs that can influence the per-second pricing key. Different models key off
 * different dimensions (Seedance: resolution + reference video; Veo 3.1 Fast:
 * audio), so pricingKey() takes the full context and uses what it needs.
 */
export type VideoPricingContext = {
  resolution?: VideoResolution | string | null;
  hasReferenceVideo?: boolean;
  generateAudio?: boolean;
};

/** Reference-input capabilities for a model. A count of 0 = the slot is unsupported. */
export type VideoReferenceCaps = {
  /** First-frame (image-to-video) input. */
  firstFrame: boolean;
  /** Last-frame input (requires a first frame). */
  lastFrame: boolean;
  /** Max reference images (character/style/composition). */
  referenceImages: number;
  /** Max reference videos (motion/style transfer). */
  referenceVideos: number;
  /** Max reference audios (audio-driven / lip-sync). */
  referenceAudios: number;
};

export type VideoModel = {
  id: VideoModelId;
  label: string;
  /** Friendly name shown in the model chip. */
  modelLabel: string;
  /** model_configs config_key (under tool_key "reels") used by the resolver. */
  modelRole: string;
  /** Canonical Replicate model id (resolver fallback / metadata). */
  providerModel: `${string}/${string}`;
  /** Provider input family — how buildVideoProviderInput assembles the input. */
  providerFamily: VideoProviderFamily;
  durations: number[];
  defaultDuration: number;
  resolutions: VideoResolution[];
  defaultResolution: VideoResolution;
  aspectRatios: VideoAspectRatio[];
  defaultAspectRatio: VideoAspectRatio;
  supportsAudio: boolean;
  defaultGenerateAudio: boolean;
  references: VideoReferenceCaps;
  /**
   * Per-second pricing key, variant-aware. Seedance keys off resolution + whether
   * a reference video is present ("video_in"); Veo 3.1 Fast keys off audio. Drives
   * the per-second cost for BOTH the client label and the server billing.
   */
  pricingKey: (ctx: VideoPricingContext) => string;
};

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance2_fast",
    label: "Seedance 2 Fast",
    modelLabel: "Seedance 2 Fast",
    // Reuses the existing reels.video model_configs row (fallback below) so an
    // admin override of that row applies here too.
    modelRole: "video",
    providerModel: "bytedance/seedance-2.0-fast",
    providerFamily: "seedance2",
    durations: [5, 10, 15],
    defaultDuration: 5,
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21", "adaptive"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 9,
      referenceVideos: 3,
      referenceAudios: 3,
    },
    pricingKey: (ctx) =>
      seedanceFastPricingKey({
        resolution: ctx.resolution ?? undefined,
        hasReferenceVideo: !!ctx.hasReferenceVideo,
      }),
  },
  {
    id: "seedance2",
    label: "Seedance 2",
    modelLabel: "Seedance 2",
    // Distinct config_key (not reels.video, which is the Fast/Reels pipeline model).
    // No model_configs row is seeded for it — the resolver falls back to providerModel.
    modelRole: "video_seedance2",
    providerModel: "bytedance/seedance-2.0",
    providerFamily: "seedance2",
    durations: [5, 10, 15],
    defaultDuration: 5,
    // Full model adds a 1080p tier on top of 480p/720p.
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21", "adaptive"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 9,
      referenceVideos: 3,
      referenceAudios: 3,
    },
    pricingKey: (ctx) =>
      seedance2PricingKey({
        resolution: ctx.resolution ?? undefined,
        hasReferenceVideo: !!ctx.hasReferenceVideo,
      }),
  },
  {
    id: "veo31_fast",
    label: "Veo 3.1 Fast",
    modelLabel: "Veo 3.1 Fast",
    // Distinct config_key; no model_configs row seeded — resolver falls back to providerModel.
    modelRole: "video_veo31_fast",
    providerModel: "google/veo-3.1-fast",
    providerFamily: "veo31fast",
    durations: [4, 6, 8],
    defaultDuration: 8,
    resolutions: ["720p", "1080p"],
    defaultResolution: "1080p",
    // Veo 3.1 Fast only supports landscape/portrait.
    aspectRatios: ["16:9", "9:16"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    references: {
      // First/last frame only — no reference image/video/audio arrays.
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    // Priced by audio, not resolution.
    pricingKey: (ctx) => veo31FastPricingKey({ generateAudio: ctx.generateAudio ?? true }),
  },
];

const MODEL_BY_ID = Object.fromEntries(
  VIDEO_MODELS.map((m) => [m.id, m])
) as Record<VideoModelId, VideoModel>;

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "seedance2_fast";

export function isValidVideoModelId(id: string): id is VideoModelId {
  return id in MODEL_BY_ID;
}

export function getVideoModel(id: string): VideoModel {
  return MODEL_BY_ID[(id as VideoModelId)] ?? MODEL_BY_ID[DEFAULT_VIDEO_MODEL_ID];
}

export function isValidVideoResolution(
  model: VideoModel,
  resolution: string
): resolution is VideoResolution {
  return (model.resolutions as string[]).includes(resolution);
}

export function isValidVideoAspectRatio(
  model: VideoModel,
  aspectRatio: string
): aspectRatio is VideoAspectRatio {
  return (model.aspectRatios as string[]).includes(aspectRatio);
}

export function isValidVideoDuration(model: VideoModel, duration: number): boolean {
  return model.durations.includes(duration);
}

/** Reference inputs as resolved (public) URLs, ready for the provider. */
export type VideoReferenceInputs = {
  firstFrame?: string | null;
  lastFrame?: string | null;
  referenceImages?: string[];
  referenceVideos?: string[];
  referenceAudios?: string[];
};

export type VideoReferenceValidation = { ok: true } | { ok: false; error: string };

/**
 * Enforce the Seedance 2 reference rules (mirrors the provider schema):
 *   - reference_images cannot be combined with first/last frame images.
 *   - last_frame_image requires a first frame (image).
 *   - reference_audios require at least one reference image OR reference video.
 *   - per-slot count caps from the model capability envelope.
 * Used by BOTH the client (to disable conflicting slots) and the server (400).
 */
export function validateVideoReferences(
  model: VideoModel,
  refs: VideoReferenceInputs
): VideoReferenceValidation {
  const caps = model.references;
  const firstFrame = refs.firstFrame || null;
  const lastFrame = refs.lastFrame || null;
  const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
  const referenceVideos = (refs.referenceVideos ?? []).filter(Boolean);
  const referenceAudios = (refs.referenceAudios ?? []).filter(Boolean);

  if (firstFrame && !caps.firstFrame) {
    return { ok: false, error: "This model does not accept a first-frame image." };
  }
  if (lastFrame && !caps.lastFrame) {
    return { ok: false, error: "This model does not accept a last-frame image." };
  }
  if (referenceImages.length > caps.referenceImages) {
    return { ok: false, error: `Up to ${caps.referenceImages} reference images are allowed.` };
  }
  if (referenceVideos.length > caps.referenceVideos) {
    return { ok: false, error: `Up to ${caps.referenceVideos} reference videos are allowed.` };
  }
  if (referenceAudios.length > caps.referenceAudios) {
    return { ok: false, error: `Up to ${caps.referenceAudios} reference audios are allowed.` };
  }

  if (referenceImages.length > 0 && (firstFrame || lastFrame)) {
    return {
      ok: false,
      error: "Reference images can't be combined with first/last frame images.",
    };
  }
  if (lastFrame && !firstFrame) {
    return { ok: false, error: "A last-frame image requires a first-frame image." };
  }
  if (
    referenceAudios.length > 0 &&
    referenceImages.length === 0 &&
    referenceVideos.length === 0
  ) {
    return {
      ok: false,
      error: "Reference audio needs at least one reference image or reference video.",
    };
  }

  return { ok: true };
}

/**
 * Build the Replicate input for a video generation. Only sends the fields the
 * model family supports, and never invents unsupported params. Assumes refs were
 * already validated with validateVideoReferences.
 */
export function buildVideoProviderInput(params: {
  model: VideoModel;
  prompt: string;
  duration: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  generateAudio: boolean;
  seed?: number | null;
  negativePrompt?: string | null;
  references: VideoReferenceInputs;
}): Record<string, unknown> {
  const { references: refs } = params;
  const hasSeed = typeof params.seed === "number" && Number.isFinite(params.seed);
  const negativePrompt =
    typeof params.negativePrompt === "string" && params.negativePrompt.trim().length > 0
      ? params.negativePrompt.trim()
      : null;

  switch (params.model.providerFamily) {
    case "veo31fast": {
      // google/veo-3.1-fast: prompt + duration/resolution/aspect_ratio + audio,
      // optional first frame (image) / last_frame, negative_prompt, seed.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
        generate_audio: params.generateAudio,
      };
      if (hasSeed) input.seed = params.seed;
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.image = refs.firstFrame;
      if (refs.lastFrame) input.last_frame = refs.lastFrame;
      return input;
    }
    case "seedance2":
    default: {
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
        generate_audio: params.generateAudio,
      };
      if (hasSeed) input.seed = params.seed;
      const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
      const referenceVideos = (refs.referenceVideos ?? []).filter(Boolean);
      const referenceAudios = (refs.referenceAudios ?? []).filter(Boolean);
      if (refs.firstFrame) input.image = refs.firstFrame;
      if (refs.lastFrame) input.last_frame_image = refs.lastFrame;
      if (referenceImages.length) input.reference_images = referenceImages;
      if (referenceVideos.length) input.reference_videos = referenceVideos;
      if (referenceAudios.length) input.reference_audios = referenceAudios;
      return input;
    }
  }
}
