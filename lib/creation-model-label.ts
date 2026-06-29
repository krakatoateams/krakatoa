import { CREATION_TOOLS, type CreationHistoryItem, type CreationTool } from "@/lib/creations";
import {
  getMotionControlModel,
  isValidMotionControlModelId,
  MOTION_CONTROL_MODEL_REGISTRY,
} from "@/lib/motion-control-models";
import {
  getProductPhotoTier,
  isValidProductPhotoTier,
  PRODUCT_PHOTO_TIERS,
} from "@/lib/product-photo";
import { getVideoModel, isValidVideoModelId, VIDEO_MODELS } from "@/lib/video-models";

const LABEL_BY_PROVIDER = new Map<string, string>();
for (const m of VIDEO_MODELS) LABEL_BY_PROVIDER.set(m.providerModel, m.modelLabel);
for (const m of MOTION_CONTROL_MODEL_REGISTRY) {
  LABEL_BY_PROVIDER.set(m.providerModel, m.modelLabel);
}
for (const t of PRODUCT_PHOTO_TIERS) LABEL_BY_PROVIDER.set(t.providerModel, t.modelLabel);

/** Known admin defaults when metadata predates modelLabel storage. */
const TOOL_MODEL_FALLBACK: Partial<Record<CreationTool, string>> = {
  reels_seedance: "Seedance 2 Fast",
  reels_veo: "Veo 3.1 Lite",
  storyboard: "GPT Image 2",
  storyboard_video: "Seedance 2 Mini",
};

export function labelForProviderModel(providerModel: string): string {
  return LABEL_BY_PROVIDER.get(providerModel) ?? humanizeProviderSlug(providerModel);
}

function humanizeProviderSlug(slug: string): string {
  const base = slug.split(":")[0]?.split("/").pop() ?? slug;
  return base
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Human-readable model name for a library/history item, or null if unknown. */
export function getCreationModelLabel(item: CreationHistoryItem): string | null {
  const m = item.metadata;

  // `assets.model` (injected as providerModel when listing history) wins over
  // denormalized user_creations metadata — it is the billing source of truth.
  if (typeof m.providerModel === "string" && m.providerModel.trim()) {
    return labelForProviderModel(m.providerModel.trim());
  }

  if (typeof m.modelTier === "string" && isValidProductPhotoTier(m.modelTier)) {
    return getProductPhotoTier(m.modelTier).modelLabel;
  }

  if (typeof m.modelLabel === "string" && m.modelLabel.trim()) {
    return m.modelLabel.trim();
  }

  const videoModelId =
    typeof m.videoModelId === "string" ? m.videoModelId : null;
  if (videoModelId && isValidVideoModelId(videoModelId)) {
    return getVideoModel(videoModelId).modelLabel;
  }

  const modelId = typeof m.modelId === "string" ? m.modelId : null;
  if (modelId) {
    if (isValidVideoModelId(modelId)) return getVideoModel(modelId).modelLabel;
    if (isValidMotionControlModelId(modelId)) {
      return getMotionControlModel(modelId).modelLabel;
    }
  }

  if (m.engine === "seedance") return "Seedance 2 Fast";
  if (m.engine === "veo") return "Veo 3.1 Lite";

  if (m.source === "uploaded") return null;

  const toolFallback = TOOL_MODEL_FALLBACK[item.tool];
  if (toolFallback) return toolFallback;

  const toolMeta = CREATION_TOOLS[item.tool];
  if (toolMeta?.label.includes("(")) {
    const match = toolMeta.label.match(/\(([^)]+)\)/);
    if (match?.[1]) return match[1];
  }

  return null;
}
