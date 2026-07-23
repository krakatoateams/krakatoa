import {
  VIDEO_MODELS,
  isTextToVideoModel,
  isImageToVideoModel,
  isStoryboardVideoModelId,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_IMAGE_TO_VIDEO_MODEL_ID,
  DEFAULT_STORYBOARD_VIDEO_MODEL_ID,
  type VideoModelId,
} from "@/lib/video-models";
import {
  MOTION_CONTROL_MODELS,
  type MotionControlModelId,
} from "@/lib/motion-control-models";

/**
 * Video studio composers (Admin Config v2 — per-composer model enablement).
 *
 * THREE DEFINITIONS MUST STAY ALIGNED (same contract as creation-features.ts):
 *   1. SQL table        — feature_model_configs (tool_key = 'reels')
 *   2. Runtime fallback — lib/feature-model-configs-db.ts merges DB rows over
 *                         these code defaults; a missing row = shipped default.
 *   3. Defaults/seed     — this file (defaultVideoComposerRows()).
 */

export const VIDEO_COMPOSER_KEYS = [
  "text2video",
  "image2video",
  "motion_control",
  "storyboard",
  "reels-creator",
] as const;

export type VideoComposerKey = (typeof VIDEO_COMPOSER_KEYS)[number];

export type VideoComposerFeature = {
  key: VideoComposerKey;
  toolKey: "reels";
  label: string;
};

export const VIDEO_COMPOSER_FEATURES: VideoComposerFeature[] = [
  { key: "text2video", toolKey: "reels", label: "Text to video" },
  { key: "image2video", toolKey: "reels", label: "Image to video" },
  { key: "motion_control", toolKey: "reels", label: "Motion control" },
  { key: "storyboard", toolKey: "reels", label: "Storyboard to video" },
  { key: "reels-creator", toolKey: "reels", label: "Reels Creator" },
];

const COMPOSER_BY_KEY = Object.fromEntries(
  VIDEO_COMPOSER_FEATURES.map((c) => [c.key, c])
) as Record<VideoComposerKey, VideoComposerFeature>;

export const REELS_CREATOR_MODEL_IDS = new Set<VideoModelId>([
  "seedance2_mini",
  "seedance2_fast",
  "seedance2",
  "seedance15_pro",
  "veo31_fast",
  "veo31_lite",
]);

const MOTION_CONTROL_MODEL_IDS = new Set(MOTION_CONTROL_MODELS.map((m) => m.id));

export type VideoComposerModelId = VideoModelId | MotionControlModelId;

export function isVideoComposerKey(key: string): key is VideoComposerKey {
  return key in COMPOSER_BY_KEY;
}

export function getVideoComposer(key: VideoComposerKey): VideoComposerFeature {
  return COMPOSER_BY_KEY[key];
}

/** Hard capability gate — admin cannot enable impossible composer × model pairs. */
export function modelEligibleForComposer(
  modelId: string,
  composerKey: VideoComposerKey
): boolean {
  if (MOTION_CONTROL_MODEL_IDS.has(modelId as MotionControlModelId)) {
    return composerKey === "motion_control";
  }

  const model = VIDEO_MODELS.find((m) => m.id === modelId);
  if (!model) return false;

  switch (composerKey) {
    case "text2video":
      return isTextToVideoModel(model);
    case "image2video":
      return isImageToVideoModel(model);
    case "motion_control":
      return false;
    case "storyboard":
      return isStoryboardVideoModelId(model.id);
    case "reels-creator":
      return REELS_CREATOR_MODEL_IDS.has(model.id);
    default:
      return false;
  }
}

/** All model ids eligible for a composer (catalog order). */
export function eligibleModelsForComposer(composerKey: VideoComposerKey): string[] {
  const ids: string[] = [];
  for (const model of VIDEO_MODELS) {
    if (modelEligibleForComposer(model.id, composerKey)) ids.push(model.id);
  }
  for (const model of MOTION_CONTROL_MODELS) {
    if (modelEligibleForComposer(model.id, composerKey)) ids.push(model.id);
  }
  return ids;
}

/** Shipped default model for a composer (must be in eligible set). */
export function defaultModelForComposer(composerKey: VideoComposerKey): string {
  const eligible = eligibleModelsForComposer(composerKey);
  const preferred =
    composerKey === "text2video"
      ? DEFAULT_VIDEO_MODEL_ID
      : composerKey === "image2video"
        ? DEFAULT_IMAGE_TO_VIDEO_MODEL_ID
        : composerKey === "motion_control"
          ? MOTION_CONTROL_MODELS[0]?.id
          : composerKey === "storyboard"
            ? DEFAULT_STORYBOARD_VIDEO_MODEL_ID
            : "seedance2_fast";

  if (preferred && eligible.includes(preferred)) return preferred;
  return eligible[0] ?? preferred;
}

export type VideoComposerModelDefault = {
  toolKey: "reels";
  featureKey: VideoComposerKey;
  modelTier: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
};

/** Full shipped enablement matrix for video composers (eligible pairs only). */
export function defaultVideoComposerRows(): VideoComposerModelDefault[] {
  const rows: VideoComposerModelDefault[] = [];
  for (const composer of VIDEO_COMPOSER_FEATURES) {
    const eligible = eligibleModelsForComposer(composer.key);
    const defaultTier = defaultModelForComposer(composer.key);
    eligible.forEach((tier, i) => {
      rows.push({
        toolKey: "reels",
        featureKey: composer.key,
        modelTier: tier,
        enabled: true,
        isDefault: tier === defaultTier,
        sortOrder: i,
      });
    });
  }
  return rows;
}

export type VideoComposerEnablement = {
  enabledModelIds: string[];
  defaultModelId: string;
};

/** Map DB resolver shape to studio helpers. */
export function mapVideoComposerEnablement(
  raw: Record<VideoComposerKey, { enabledTiers: string[]; defaultTier: string }>
): Record<VideoComposerKey, VideoComposerEnablement> {
  const out = {} as Record<VideoComposerKey, VideoComposerEnablement>;
  for (const key of VIDEO_COMPOSER_KEYS) {
    out[key] = {
      enabledModelIds: raw[key]?.enabledTiers ?? [],
      defaultModelId: raw[key]?.defaultTier ?? defaultModelForComposer(key),
    };
  }
  return out;
}

/** Filter a catalog to admin-enabled models; falls back to full catalog if empty. */
export function filterEnabledCatalog<T extends { id: string }>(
  catalog: readonly T[],
  composerKey: VideoComposerKey,
  enablement: Record<VideoComposerKey, VideoComposerEnablement> | null
): T[] {
  if (!enablement) return [...catalog];
  const { enabledModelIds } = enablement[composerKey];
  const filtered = catalog.filter((m) => enabledModelIds.includes(m.id));
  return filtered.length > 0 ? filtered : [...catalog];
}

/** Snap selection to an enabled model (admin default wins when still enabled). */
export function snapToEnabledModel(
  currentId: string,
  catalog: readonly { id: string }[],
  composerKey: VideoComposerKey,
  enablement: Record<VideoComposerKey, VideoComposerEnablement> | null
): string {
  const enabled = filterEnabledCatalog(catalog, composerKey, enablement);
  if (enabled.some((m) => m.id === currentId)) return currentId;
  const preferred = enablement?.[composerKey]?.defaultModelId;
  if (preferred && enabled.some((m) => m.id === preferred)) return preferred;
  return enabled[0]?.id ?? currentId;
}

/** Reels Creator engine → catalog model ids used for enablement gating. */
export const REELS_ENGINE_MODEL_IDS: Record<"seedance" | "veo", string[]> = {
  seedance: ["seedance2_mini", "seedance2_fast", "seedance2", "seedance15_pro"],
  veo: ["veo31_fast", "veo31_lite"],
};

export function filterReelsEngines<
  T extends { id: "seedance" | "veo" },
>(engines: readonly T[], enablement: Record<VideoComposerKey, VideoComposerEnablement> | null): T[] {
  if (!enablement) return [...engines];
  const enabled = new Set(enablement["reels-creator"].enabledModelIds);
  const filtered = engines.filter((e) =>
    REELS_ENGINE_MODEL_IDS[e.id].some((id) => enabled.has(id))
  );
  return filtered.length > 0 ? filtered : [...engines];
}

/** True when at least one model is enabled for this composer. */
export function composerHasEnabledModels(
  composerKey: VideoComposerKey,
  enablement: Record<VideoComposerKey, VideoComposerEnablement> | null
): boolean {
  if (!enablement) return true;
  return enablement[composerKey].enabledModelIds.length > 0;
}

// ponytail: runnable self-check — `npx tsx lib/video-composer-features.ts`
if (require.main === module) {
  const rows = defaultVideoComposerRows();
  const defaults = VIDEO_COMPOSER_KEYS.map((k) => [k, defaultModelForComposer(k)] as const);
  const perComposer = Object.fromEntries(
    VIDEO_COMPOSER_KEYS.map((k) => [k, eligibleModelsForComposer(k).length])
  );
  console.assert(rows.length === 29, `expected 29 rows, got ${rows.length}`);
  for (const [key, modelId] of defaults) {
    console.assert(
      modelEligibleForComposer(modelId, key),
      `default ${modelId} must be eligible for ${key}`
    );
  }
  console.log("video-composer-features ok", { rows: rows.length, perComposer, defaults });
}
