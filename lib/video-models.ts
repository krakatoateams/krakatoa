import {
  seedanceFastPricingKey,
  seedance2PricingKey,
  seedance2MiniPricingKey,
  seedance15PricingKey,
  seedance1ProFastPricingKey,
  seedance1ProPricingKey,
  seedance1LitePricingKey,
  veo31FastPricingKey,
  veo31LitePricingKey,
  klingV3PricingKey,
  klingV3OmniPricingKey,
  kling15StandardPricingKey,
  kling15ProPricingKey,
  kling16StandardPricingKey,
  kling16ProPricingKey,
  kling20PricingKey,
  kling21PricingKey,
  kling25TurboProPricingKey,
  kling26PricingKey,
} from "@/lib/pricing-math";

/**
 * Video model registry (Text to Video + Image to Video at /tools/video).
 *
 * Analogous to lib/product-photo.ts (PRODUCT_PHOTO_TIERS): each model declares
 * its provider id, the model_configs config_key used to resolve/override it, its
 * capability envelope (durations, resolutions, aspect ratios, audio, reference
 * slots), which subtool(s) it belongs to, and the pricing key used by BOTH the
 * client label and the server billing. Adding a new video model later = adding
 * an entry here + a per-family branch in buildVideoProviderInput.
 *
 * Models that require a start image live under the Image to Video subtool only
 * (`subtools: ["image2video"]`) so Text to Video stays prompt-first.
 */

export type VideoModelId =
  | "seedance2_mini"
  | "seedance2_fast"
  | "seedance2"
  | "seedance15_pro"
  | "seedance1_pro_fast"
  | "seedance1_pro"
  | "seedance1_lite"
  | "veo31_fast"
  | "veo31_lite"
  | "kling_v3"
  | "kling_v3_omni"
  | "kling20"
  | "kling21"
  | "kling25_turbo_pro"
  | "kling26"
  | "kling16_standard"
  | "kling16_pro"
  | "kling15_standard"
  | "kling15_pro";

/** Storyboard to Video — Seedance-family models only. */
export type StoryboardVideoModelId = "seedance2_mini" | "seedance2_fast";

export type VideoResolution = "480p" | "720p" | "1080p" | "4k";

export type VideoAspectRatio =
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "21:9"
  | "9:21"
  | "adaptive";

/** Which Video Studio composer(s) may offer this model. Defaults to text2video. */
export type VideoSubtool = "text2video" | "image2video";

export type VideoJobKind = "video_text2video" | "video_image2video";

export type VideoProviderFamily =
  | "seedance2"
  | "seedance15"
  | "seedance1fast"
  | "seedance1pro"
  | "seedance1lite"
  | "veo31fast"
  | "veo31lite"
  | "klingv3"
  | "kling3omni"
  | "kling20"
  | "kling21"
  | "kling25turbo"
  | "kling26"
  | "kling16"
  | "kling16pro"
  | "kling15"
  | "kling15pro";

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
  /**
   * Optional resolution-dependent duration constraint. When set, it returns the
   * allowed durations for a given resolution (e.g. Veo 3.1 Lite only allows 8s at
   * 1080p). When omitted, all `durations` are valid at every resolution.
   */
  durationsFor?: (resolution: VideoResolution) => number[];
  resolutions: VideoResolution[];
  defaultResolution: VideoResolution;
  aspectRatios: VideoAspectRatio[];
  defaultAspectRatio: VideoAspectRatio;
  supportsAudio: boolean;
  defaultGenerateAudio: boolean;
  /** Max prompt length (chars) the provider accepts. Omitted = platform default. */
  promptMaxChars?: number;
  references: VideoReferenceCaps;
  /** When true, a first-frame / start image must be attached before generation. */
  requiresFirstFrame?: boolean;
  /** Subtool(s) that expose this model. Omitted = text2video only. */
  subtools?: VideoSubtool[];
  /**
   * Per-second pricing key, variant-aware. Seedance keys off resolution + whether
   * a reference video is present ("video_in"); Veo 3.1 Fast keys off audio. Drives
   * the per-second cost for BOTH the client label and the server billing.
   */
  pricingKey: (ctx: VideoPricingContext) => string;
};

export const VIDEO_MODELS: VideoModel[] = [
  {
    id: "seedance2_mini",
    label: "Seedance 2 Mini",
    modelLabel: "Seedance 2 Mini",
    modelRole: "video_seedance2_mini",
    providerModel: "bytedance/seedance-2.0-mini",
    providerFamily: "seedance2",
    durations: [5, 10, 15],
    defaultDuration: 5,
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21", "adaptive"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    promptMaxChars: 4000,
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 9,
      referenceVideos: 3,
      referenceAudios: 3,
    },
    pricingKey: (ctx) =>
      seedance2MiniPricingKey({
        resolution: ctx.resolution ?? undefined,
        hasReferenceVideo: !!ctx.hasReferenceVideo,
      }),
  },
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
    id: "seedance15_pro",
    label: "Seedance 1.5 Pro",
    modelLabel: "Seedance 1.5 Pro",
    modelRole: "video_seedance15_pro",
    providerModel: "bytedance/seedance-1.5-pro",
    providerFamily: "seedance15",
    // Provider accepts any integer 2–12s; discrete set for the UI chips.
    durations: [4, 5, 6, 8, 10, 12],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    references: {
      // First/last frame only (image / last_frame_image) — no reference arrays.
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) =>
      seedance15PricingKey({
        resolution: ctx.resolution ?? undefined,
        generateAudio: ctx.generateAudio ?? true,
      }),
  },
  {
    id: "seedance1_pro_fast",
    label: "Seedance 1 Pro Fast",
    modelLabel: "Seedance 1 Pro Fast",
    modelRole: "video_seedance1_pro_fast",
    providerModel: "bytedance/seedance-1-pro-fast",
    providerFamily: "seedance1fast",
    durations: [4, 5, 6, 8, 10, 12],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "1080p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      // First-frame i2v only — no last frame, no reference arrays, no audio.
      firstFrame: true,
      lastFrame: false,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) => seedance1ProFastPricingKey(ctx.resolution),
  },
  {
    id: "seedance1_pro",
    label: "Seedance 1 Pro",
    modelLabel: "Seedance 1 Pro",
    modelRole: "video_seedance1_pro",
    providerModel: "bytedance/seedance-1-pro",
    providerFamily: "seedance1pro",
    durations: [4, 5, 6, 8, 10, 12],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "1080p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) => seedance1ProPricingKey(ctx.resolution),
  },
  {
    id: "seedance1_lite",
    label: "Seedance 1 Lite",
    modelLabel: "Seedance 1 Lite",
    modelRole: "video_seedance1_lite",
    providerModel: "bytedance/seedance-1-lite",
    providerFamily: "seedance1lite",
    // Provider minimum is 4s (not 2s like other Seedance 1.x models).
    durations: [4, 5, 6, 8, 10, 12],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      firstFrame: true,
      lastFrame: true,
      // 1–4 reference images (mutually exclusive with 1080p and first/last frame).
      referenceImages: 4,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) => seedance1LitePricingKey(ctx.resolution),
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
  {
    id: "veo31_lite",
    label: "Veo 3.1 Lite",
    modelLabel: "Veo 3.1 Lite",
    modelRole: "video_veo31_lite",
    providerModel: "google/veo-3.1-lite",
    providerFamily: "veo31lite",
    durations: [4, 6, 8],
    defaultDuration: 8,
    // 1080p only supports an 8s clip; 720p allows the full set.
    durationsFor: (resolution) => (resolution === "1080p" ? [8] : [4, 6, 8]),
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16"],
    defaultAspectRatio: "9:16",
    // Veo 3.1 Lite has no audio generation.
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      // First/last frame only — no reference image/video/audio arrays.
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) => veo31LitePricingKey(ctx.resolution),
  },
  {
    id: "kling_v3",
    label: "Kling v3",
    modelLabel: "Kling v3",
    modelRole: "video_kling_v3",
    providerModel: "kwaivgi/kling-v3-video",
    providerFamily: "klingv3",
    // Provider accepts any integer 3–15s; we surface a discrete set.
    durations: [5, 10, 15],
    defaultDuration: 5,
    // Kling's `mode` maps to a resolution: standard=720p, pro=1080p, 4k=4K. We
    // present it as a resolution chip and translate to `mode` in the builder.
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "1080p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: false,
    promptMaxChars: 2500,
    references: {
      // start_image / end_image only — no reference arrays.
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    // Priced by mode (resolution tier) × audio.
    pricingKey: (ctx) =>
      klingV3PricingKey({
        resolution: ctx.resolution,
        generateAudio: ctx.generateAudio ?? false,
      }),
  },
  {
    id: "kling_v3_omni",
    label: "Kling v3 Omni",
    modelLabel: "Kling v3 Omni",
    modelRole: "video_kling_v3_omni",
    providerModel: "kwaivgi/kling-v3-omni-video",
    providerFamily: "kling3omni",
    durations: [5, 10, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "1080p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: false,
    promptMaxChars: 2500,
    references: {
      firstFrame: true,
      lastFrame: true,
      // Max 7 without reference video, 4 with — enforced in validateVideoReferences.
      referenceImages: 7,
      referenceVideos: 1,
      referenceAudios: 0,
    },
    pricingKey: (ctx) =>
      klingV3OmniPricingKey({
        resolution: ctx.resolution,
        generateAudio: ctx.generateAudio ?? false,
      }),
  },
  {
    id: "kling20",
    label: "Kling v2.0",
    modelLabel: "Kling v2.0",
    modelRole: "video_kling20",
    providerModel: "kwaivgi/kling-v2.0",
    providerFamily: "kling20",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      firstFrame: true,
      lastFrame: false,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling20PricingKey(),
  },
  {
    id: "kling16_standard",
    label: "Kling v1.6 Standard",
    modelLabel: "Kling v1.6 Standard",
    modelRole: "video_kling16_standard",
    providerModel: "kwaivgi/kling-v1.6-standard",
    providerFamily: "kling16",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      firstFrame: true,
      lastFrame: false,
      referenceImages: 4,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling16StandardPricingKey(),
  },
  {
    id: "kling16_pro",
    label: "Kling v1.6 Pro",
    modelLabel: "Kling v1.6 Pro",
    modelRole: "video_kling16_pro",
    providerModel: "kwaivgi/kling-v1.6-pro",
    providerFamily: "kling16pro",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    subtools: ["image2video"],
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 4,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling16ProPricingKey(),
  },
  {
    id: "kling21",
    label: "Kling v2.1",
    modelLabel: "Kling v2.1",
    modelRole: "video_kling21",
    providerModel: "kwaivgi/kling-v2.1",
    providerFamily: "kling21",
    durations: [5, 10],
    defaultDuration: 5,
    // Provider `mode`: standard=720p, pro=1080p (no aspect_ratio input).
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9"],
    defaultAspectRatio: "16:9",
    supportsAudio: false,
    defaultGenerateAudio: false,
    requiresFirstFrame: true,
    subtools: ["image2video"],
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) => kling21PricingKey({ resolution: ctx.resolution }),
  },
  {
    id: "kling25_turbo_pro",
    label: "Kling v2.5 Turbo Pro",
    modelLabel: "Kling v2.5 Turbo Pro",
    modelRole: "video_kling25_turbo_pro",
    providerModel: "kwaivgi/kling-v2.5-turbo-pro",
    providerFamily: "kling25turbo",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling25TurboProPricingKey(),
  },
  {
    id: "kling26",
    label: "Kling v2.6",
    modelLabel: "Kling v2.6",
    modelRole: "video_kling26",
    providerModel: "kwaivgi/kling-v2.6",
    providerFamily: "kling26",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: true,
    defaultGenerateAudio: true,
    references: {
      firstFrame: true,
      lastFrame: false,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: (ctx) =>
      kling26PricingKey({ generateAudio: ctx.generateAudio ?? true }),
  },
  {
    id: "kling15_standard",
    label: "Kling v1.5 Standard",
    modelLabel: "Kling v1.5 Standard",
    modelRole: "video_kling15_standard",
    providerModel: "kwaivgi/kling-v1.5-standard",
    providerFamily: "kling15",
    durations: [5, 10],
    defaultDuration: 5,
    // Flat-rate model — no resolution input; single placeholder for billing/UI typing.
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    requiresFirstFrame: true,
    subtools: ["image2video"],
    references: {
      firstFrame: true,
      lastFrame: false,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling15StandardPricingKey(),
  },
  {
    id: "kling15_pro",
    label: "Kling v1.5 Pro",
    modelLabel: "Kling v1.5 Pro",
    modelRole: "video_kling15_pro",
    providerModel: "kwaivgi/kling-v1.5-pro",
    providerFamily: "kling15pro",
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p"],
    defaultResolution: "720p",
    aspectRatios: ["16:9", "9:16", "1:1"],
    defaultAspectRatio: "9:16",
    supportsAudio: false,
    defaultGenerateAudio: false,
    subtools: ["image2video"],
    references: {
      firstFrame: true,
      lastFrame: true,
      referenceImages: 0,
      referenceVideos: 0,
      referenceAudios: 0,
    },
    pricingKey: () => kling15ProPricingKey(),
  },
];

const MODEL_BY_ID = Object.fromEntries(
  VIDEO_MODELS.map((m) => [m.id, m])
) as Record<VideoModelId, VideoModel>;

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "seedance2_fast";

export function modelSubtools(model: VideoModel): VideoSubtool[] {
  return model.subtools ?? ["text2video"];
}

export function isTextToVideoModel(model: VideoModel): boolean {
  return modelSubtools(model).includes("text2video");
}

export function isImageToVideoModel(model: VideoModel): boolean {
  return modelSubtools(model).includes("image2video");
}

export const TEXT_TO_VIDEO_MODELS = VIDEO_MODELS.filter(isTextToVideoModel);
export const IMAGE_TO_VIDEO_MODELS = VIDEO_MODELS.filter(isImageToVideoModel);

export const DEFAULT_IMAGE_TO_VIDEO_MODEL_ID: VideoModelId =
  IMAGE_TO_VIDEO_MODELS[0]?.id ?? "kling15_standard";

/** Job/history kind derived from subtool membership (image-only → image2video). */
export function getVideoJobKind(model: VideoModel): VideoJobKind {
  const subtools = modelSubtools(model);
  if (subtools.length === 1 && subtools[0] === "image2video") {
    return "video_image2video";
  }
  return "video_text2video";
}

/** Default Storyboard-to-Video model (cheaper Mini tier). */
export const DEFAULT_STORYBOARD_VIDEO_MODEL_ID: StoryboardVideoModelId = "seedance2_mini";

export const STORYBOARD_VIDEO_MODEL_IDS: StoryboardVideoModelId[] = [
  "seedance2_mini",
  "seedance2_fast",
];

export function isStoryboardVideoModelId(id: string): id is StoryboardVideoModelId {
  return (STORYBOARD_VIDEO_MODEL_IDS as string[]).includes(id);
}

export function isValidVideoModelId(id: string): id is VideoModelId {
  return id in MODEL_BY_ID;
}

export function getVideoModel(id: string): VideoModel {
  return MODEL_BY_ID[(id as VideoModelId)] ?? MODEL_BY_ID[DEFAULT_VIDEO_MODEL_ID];
}

/** Kling v1.6 models allow start/end frames alongside reference_images. */
export function allowsFrameWithReferenceImages(family: VideoProviderFamily): boolean {
  return family === "kling16" || family === "kling16pro" || family === "kling3omni";
}

/** Kling v1.5/v1.6 Pro allow an end frame without a start frame. */
export function allowsEndFrameWithoutStart(family: VideoProviderFamily): boolean {
  return family === "kling15pro" || family === "kling16pro";
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

/**
 * Allowed durations for a given resolution, honoring any resolution-dependent
 * constraint (durationsFor). Falls back to the flat `durations` envelope.
 */
export function getAllowedDurations(
  model: VideoModel,
  resolution: VideoResolution
): number[] {
  return model.durationsFor ? model.durationsFor(resolution) : model.durations;
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

export type VideoReferenceValidationContext = {
  resolution?: string | null;
  generateAudio?: boolean;
};

/**
 * Enforce provider reference rules (mirrors each model's schema):
 *   - reference_images cannot be combined with first/last frame images.
 *   - last_frame_image requires a first frame (image).
 *   - reference_audios require at least one reference image OR reference video.
 *   - per-slot count caps from the model capability envelope.
 *   - Seedance 1 Lite: reference_images cannot be used at 1080p.
 * Used by BOTH the client (to disable conflicting slots) and the server (400).
 */
export function validateVideoReferences(
  model: VideoModel,
  refs: VideoReferenceInputs,
  ctx?: VideoReferenceValidationContext
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

  // Most models forbid reference_images alongside first/last frame; Kling v1.6
  // Standard allows start_image + reference_images (scene elements) together.
  if (
    referenceImages.length > 0 &&
    (firstFrame || lastFrame) &&
    !allowsFrameWithReferenceImages(model.providerFamily)
  ) {
    return {
      ok: false,
      error: "Reference images can't be combined with first/last frame images.",
    };
  }
  if (
    lastFrame &&
    !firstFrame &&
    !allowsEndFrameWithoutStart(model.providerFamily)
  ) {
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

  if (
    model.providerFamily === "seedance1lite" &&
    referenceImages.length > 0 &&
    ctx?.resolution === "1080p"
  ) {
    return {
      ok: false,
      error: "Reference images can't be used at 1080p — pick 480p or 720p.",
    };
  }

  if (model.requiresFirstFrame && !firstFrame) {
    return { ok: false, error: "This model requires a start image (first frame)." };
  }

  if (model.providerFamily === "kling15pro" && !firstFrame && !lastFrame) {
    return { ok: false, error: "This model requires a start image or end image." };
  }

  if (model.providerFamily === "kling16pro" && !firstFrame && !lastFrame) {
    return { ok: false, error: "This model requires a start image or end image." };
  }

  if (
    model.providerFamily === "kling21" &&
    lastFrame &&
    ctx?.resolution &&
    ctx.resolution !== "1080p"
  ) {
    return { ok: false, error: "End image requires Pro mode (1080p)." };
  }

  if (model.providerFamily === "kling3omni") {
    const maxRefImages = referenceVideos.length > 0 ? 4 : 7;
    if (referenceImages.length > maxRefImages) {
      return {
        ok: false,
        error: `Up to ${maxRefImages} reference images are allowed${referenceVideos.length > 0 ? " when a reference video is attached" : ""}.`,
      };
    }
    if (ctx?.resolution === "4k" && referenceVideos.length > 0) {
      return { ok: false, error: "4K mode does not support reference video." };
    }
    if (referenceVideos.length > 0 && ctx?.generateAudio) {
      return {
        ok: false,
        error: "Generated audio can't be used with a reference video — turn audio off or remove the video.",
      };
    }
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
    case "veo31lite": {
      // google/veo-3.1-lite: prompt + duration/resolution/aspect_ratio, optional
      // first frame (image) / last_frame, seed. No audio, no negative_prompt.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      };
      if (hasSeed) input.seed = params.seed;
      if (refs.firstFrame) input.image = refs.firstFrame;
      if (refs.lastFrame) input.last_frame = refs.lastFrame;
      return input;
    }
    case "klingv3": {
      // kwaivgi/kling-v3-video: uses `mode` (standard/pro/4k) instead of a
      // resolution field; start_image/end_image for frames. No seed; multi_prompt
      // is not surfaced.
      const mode =
        params.resolution === "4k" ? "4k" : params.resolution === "720p" ? "standard" : "pro";
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        mode,
        duration: params.duration,
        aspect_ratio: params.aspectRatio,
        generate_audio: params.generateAudio,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      return input;
    }
    case "kling3omni": {
      // kwaivgi/kling-v3-omni-video: mode tiers + refs (images/video) + audio.
      // generate_audio is mutually exclusive with reference_video (validated upstream).
      const mode =
        params.resolution === "4k" ? "4k" : params.resolution === "720p" ? "standard" : "pro";
      const referenceVideo = (refs.referenceVideos ?? []).filter(Boolean)[0] ?? null;
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        mode,
        duration: params.duration,
        generate_audio: params.generateAudio,
      };
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
      if (referenceImages.length) input.reference_images = referenceImages;
      if (referenceVideo) {
        input.reference_video = referenceVideo;
        input.keep_original_sound = true;
        input.video_reference_type = "feature";
      } else if (!refs.firstFrame) {
        input.aspect_ratio = params.aspectRatio;
      }
      return input;
    }
    case "kling20": {
      // kwaivgi/kling-v2.0: t2v / optional i2v via start_image. aspect_ratio
      // ignored when start_image is set.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "kling21": {
      // kwaivgi/kling-v2.1: i2v only (start_image required). mode=standard|pro;
      // end_image optional but requires pro (1080p).
      const mode = params.resolution === "1080p" ? "pro" : "standard";
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        mode,
        duration: params.duration,
        start_image: refs.firstFrame,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      return input;
    }
    case "kling25turbo": {
      // kwaivgi/kling-v2.5-turbo-pro: t2v / optional i2v via start_image + end_image.
      // aspect_ratio ignored when start_image is set.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "kling26": {
      // kwaivgi/kling-v2.6: t2v / optional i2v via start_image + generate_audio.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        generate_audio: params.generateAudio,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "kling16": {
      // kwaivgi/kling-v1.6-standard: t2v / i2v + up to 4 reference_images (scene
      // elements). aspect_ratio ignored when start_image is set.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
      if (referenceImages.length) input.reference_images = referenceImages;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "kling16pro": {
      // kwaivgi/kling-v1.6-pro: start/end image required (either) + optional refs.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
      if (referenceImages.length) input.reference_images = referenceImages;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "kling15": {
      // kwaivgi/kling-v1.5-standard: image-to-video only (start_image required).
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        start_image: refs.firstFrame,
        duration: params.duration,
        aspect_ratio: params.aspectRatio,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      return input;
    }
    case "kling15pro": {
      // kwaivgi/kling-v1.5-pro: start_image and/or end_image required; aspect_ratio
      // is ignored when start_image is provided.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
      };
      if (negativePrompt) input.negative_prompt = negativePrompt;
      if (refs.firstFrame) input.start_image = refs.firstFrame;
      if (refs.lastFrame) input.end_image = refs.lastFrame;
      if (!refs.firstFrame) input.aspect_ratio = params.aspectRatio;
      return input;
    }
    case "seedance15": {
      // bytedance/seedance-1.5-pro: t2v / i2v with optional last frame + synced audio.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
        generate_audio: params.generateAudio,
      };
      if (hasSeed) input.seed = params.seed;
      if (refs.firstFrame) input.image = refs.firstFrame;
      if (refs.lastFrame) input.last_frame_image = refs.lastFrame;
      return input;
    }
    case "seedance1fast": {
      // bytedance/seedance-1-pro-fast: t2v / i2v, silent — no audio or last frame.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      };
      if (hasSeed) input.seed = params.seed;
      if (refs.firstFrame) input.image = refs.firstFrame;
      return input;
    }
    case "seedance1pro": {
      // bytedance/seedance-1-pro: t2v / i2v + optional last frame, silent.
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      };
      if (hasSeed) input.seed = params.seed;
      if (refs.firstFrame) input.image = refs.firstFrame;
      if (refs.lastFrame) input.last_frame_image = refs.lastFrame;
      return input;
    }
    case "seedance1lite": {
      // bytedance/seedance-1-lite: t2v / i2v / ref images (480p–720p only for refs).
      const input: Record<string, unknown> = {
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.resolution,
        aspect_ratio: params.aspectRatio,
      };
      if (hasSeed) input.seed = params.seed;
      const referenceImages = (refs.referenceImages ?? []).filter(Boolean);
      if (referenceImages.length) {
        input.reference_images = referenceImages;
      } else {
        if (refs.firstFrame) input.image = refs.firstFrame;
        if (refs.lastFrame) input.last_frame_image = refs.lastFrame;
      }
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
