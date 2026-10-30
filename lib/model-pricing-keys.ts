import { PRODUCT_PHOTO_TIERS, type ProductPhotoTier } from "@/lib/product-photo";
import { MOTION_CONTROL_MODELS } from "@/lib/motion-control-models";
import {
  VIDEO_MODELS,
  type VideoModel,
  type VideoPricingContext,
  type VideoResolution,
} from "@/lib/video-models";

/**
 * Every pricing key a catalog model bills through. Single enumeration shared by the admin tree
 * (variants) and the model catalog guard (readiness), so the two can never disagree.
 */

/** Photo tier pricing keys with their admin labels (quality, single, or per-resolution). */
export function photoTierPricingEntries(
  tier: ProductPhotoTier
): { pricingKey: string; label: string }[] {
  if (tier.qualities) return tier.qualities.map((q) => ({ pricingKey: q.pricingKey, label: q.label }));
  if (tier.basicPricingKey) {
    return [{ pricingKey: tier.basicPricingKey, label: "Per image (no resolution tiers)" }];
  }
  return tier.resolutions.map((r) => ({ pricingKey: r.pricingKey, label: r.label }));
}

/** Every resolution × audio × reference-video context a video model can bill under. */
export function videoPricingContexts(model: VideoModel): VideoPricingContext[] {
  const resolutions: VideoResolution[] =
    model.resolutions.length > 0 ? model.resolutions : [model.defaultResolution];
  const audioFlags = model.supportsAudio ? [false, true] : [false];
  const refFlags = model.references.referenceVideos > 0 ? [false, true] : [false];
  const out: VideoPricingContext[] = [];
  for (const resolution of resolutions) {
    for (const generateAudio of audioFlags) {
      for (const hasReferenceVideo of refFlags) {
        out.push({ resolution, generateAudio, hasReferenceVideo });
      }
    }
  }
  return out;
}

/** Distinct pricing keys for a catalog model; [] for an unknown model. */
export function modelPricingKeys(toolKey: string, modelId: string): string[] {
  if (toolKey === "photo") {
    const tier = PRODUCT_PHOTO_TIERS.find((t) => t.id === modelId);
    return tier ? [...new Set(photoTierPricingEntries(tier).map((e) => e.pricingKey))] : [];
  }
  if (toolKey !== "reels") return [];
  const video = VIDEO_MODELS.find((m) => m.id === modelId);
  if (video) return [...new Set(videoPricingContexts(video).map((ctx) => video.pricingKey(ctx)))];
  const motion = MOTION_CONTROL_MODELS.find((m) => m.id === modelId);
  return motion ? [...new Set(motion.modes.map((mode) => motion.pricingKey(mode)))] : [];
}
