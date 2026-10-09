/**
 * Canvas Video / Image model pickers: capability + admin-enablement filtering.
 * Pure — the server (`generate-video` / `generate-photo`) stays the authority.
 * `null` enablement means "not loaded yet" and yields NO options (never the
 * full catalog).
 */
import {
  defaultModelForComposer,
  modelEligibleForComposer,
  videoComposerModelEnabled,
  type VideoComposerEnablement,
  type VideoComposerKey,
} from "./video-composer-features";
import { VIDEO_MODELS, type VideoModel } from "./video-models";
import { PRODUCT_PHOTO_TIERS, type ProductPhotoTier } from "./product-photo";

export type CanvasVideoEnablement = Record<VideoComposerKey, VideoComposerEnablement>;
export type CanvasImageEnablement = { enabledTiers: string[]; defaultTier: string | null };

/** Composer the server accepts for this model (references don't change it). */
export function canvasVideoComposerKey(modelId: string): "text2video" | "image2video" {
  return modelEligibleForComposer(modelId, "text2video") ? "text2video" : "image2video";
}

/** Capability rule: a reference image needs `referenceImages > 0`; otherwise text-to-video. */
export function canvasVideoModelFitsInput(model: VideoModel, hasRef: boolean): boolean {
  return hasRef
    ? model.references.referenceImages > 0
    : modelEligibleForComposer(model.id, "text2video");
}

export function canvasVideoModelOptions(
  hasRef: boolean,
  enablement: CanvasVideoEnablement | null
): VideoModel[] {
  if (!enablement) return [];
  return VIDEO_MODELS.filter((m) => {
    if (!canvasVideoModelFitsInput(m, hasRef)) return false;
    const key = canvasVideoComposerKey(m.id);
    return modelEligibleForComposer(m.id, key) && videoComposerModelEnabled(enablement, key, m.id);
  });
}

/** Keep a still-valid model, else the admin default (text2video, then image2video), else the first option. */
export function snapCanvasVideoModel(
  currentId: string,
  options: readonly { id: string }[],
  enablement: CanvasVideoEnablement | null
): string | null {
  if (options.some((m) => m.id === currentId)) return currentId;
  const preferred = [
    enablement?.text2video?.defaultModelId,
    enablement?.image2video?.defaultModelId,
    defaultModelForComposer("text2video"),
  ];
  return (
    preferred.find((id) => id && options.some((m) => m.id === id)) ?? options[0]?.id ?? null
  );
}

export function canvasImageTierOptions(
  hasRef: boolean,
  enablement: CanvasImageEnablement | null
): ProductPhotoTier[] {
  if (!enablement) return [];
  return PRODUCT_PHOTO_TIERS.filter(
    (t) => (!hasRef || t.supportsReference) && enablement.enabledTiers.includes(t.id)
  );
}

export function snapCanvasImageTier(
  currentId: string,
  options: readonly { id: string }[],
  enablement: CanvasImageEnablement | null
): string | null {
  if (options.some((t) => t.id === currentId)) return currentId;
  const preferred = enablement?.defaultTier;
  return (preferred && options.some((t) => t.id === preferred) ? preferred : options[0]?.id) ?? null;
}
