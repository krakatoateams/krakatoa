import {
  DEFAULT_PHOTO_ASPECT_RATIO,
  DEFAULT_PRODUCT_PHOTO_RESOLUTION,
  DEFAULT_PRODUCT_PHOTO_TIER,
  type PhotoAspectRatio,
  type ProductPhotoModelTier,
  type ProductPhotoResolution,
} from "@/lib/product-photo";
import {
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModel,
  type VideoAspectRatio,
  type VideoModelId,
  type VideoResolution,
} from "@/lib/video-models";
import {
  DEFAULT_CANVAS_TEXT_MODEL_ID,
  type CanvasTextModelId,
} from "@/lib/canvas-text-models";
import { nextCanvasNodeName, type CanvasNodeKind } from "@/lib/canvas-graph";

export type PromptNodeData = {
  kind: "prompt";
  label: string;
  /** Form instruction. */
  prompt: string;
  /** Generated or handwritten text asset. */
  text: string;
  modelId: CanvasTextModelId;
  loading: boolean;
  error: string | null;
};

export type ImageNodeData = {
  kind: "image";
  label: string;
  prompt: string;
  modelTier: ProductPhotoModelTier;
  resolution: ProductPhotoResolution;
  aspectRatio: PhotoAspectRatio;
  resultUrl: string | null;
  resultStoragePath: string | null;
  /** `user_creations.id` when the still came from the library or a generate. */
  creationId: string | null;
  /** True when the asset was uploaded or picked from the library (no generate form). */
  imported: boolean;
  uploading: boolean;
  loading: boolean;
  error: string | null;
};

export type VideoNodeData = {
  kind: "video";
  label: string;
  prompt: string;
  modelId: VideoModelId;
  duration: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  generateAudio: boolean;
  resultUrl: string | null;
  resultStoragePath: string | null;
  creationId: string | null;
  imported: boolean;
  uploading: boolean;
  loading: boolean;
  error: string | null;
};

export type SoundNodeData = {
  kind: "sound";
  label: string;
  resultUrl: string | null;
  resultStoragePath: string | null;
  creationId: string | null;
  imported: boolean;
  uploading: boolean;
  error: string | null;
};

export type CanvasNodeData = PromptNodeData | ImageNodeData | VideoNodeData | SoundNodeData;

export function defaultPromptData(): PromptNodeData {
  return {
    kind: "prompt",
    label: "",
    prompt: "",
    text: "",
    modelId: DEFAULT_CANVAS_TEXT_MODEL_ID,
    loading: false,
    error: null,
  };
}

export function defaultImageData(): ImageNodeData {
  return {
    kind: "image",
    label: "",
    prompt: "",
    modelTier: DEFAULT_PRODUCT_PHOTO_TIER,
    resolution: DEFAULT_PRODUCT_PHOTO_RESOLUTION,
    aspectRatio: DEFAULT_PHOTO_ASPECT_RATIO,
    resultUrl: null,
    resultStoragePath: null,
    creationId: null,
    imported: false,
    uploading: false,
    loading: false,
    error: null,
  };
}

export function defaultVideoData(): VideoNodeData {
  const model = getVideoModel(DEFAULT_VIDEO_MODEL_ID);
  return {
    kind: "video",
    label: "",
    prompt: "",
    modelId: DEFAULT_VIDEO_MODEL_ID,
    duration: model.defaultDuration,
    resolution: model.defaultResolution,
    aspectRatio: model.defaultAspectRatio,
    generateAudio: model.defaultGenerateAudio,
    resultUrl: null,
    resultStoragePath: null,
    creationId: null,
    imported: false,
    uploading: false,
    loading: false,
    error: null,
  };
}

export function defaultSoundData(): SoundNodeData {
  return {
    kind: "sound",
    label: "",
    resultUrl: null,
    resultStoragePath: null,
    creationId: null,
    imported: false,
    uploading: false,
    error: null,
  };
}

export function defaultDataForKind(kind: CanvasNodeKind): CanvasNodeData {
  if (kind === "prompt") return defaultPromptData();
  if (kind === "image") return defaultImageData();
  if (kind === "video") return defaultVideoData();
  return defaultSoundData();
}

export function labeledDataForKind(
  kind: CanvasNodeKind,
  existingLabels: Array<string | undefined | null>
): CanvasNodeData {
  return { ...defaultDataForKind(kind), label: nextCanvasNodeName(kind, existingLabels) };
}

export function dataFromLibraryItem(
  item: {
    id: string;
    mediaType: "image" | "video";
    mediaUrl: string;
    storagePath: string;
  },
  existingLabels: Array<string | undefined | null> = []
): CanvasNodeData {
  const kind: CanvasNodeKind = item.mediaType === "video" ? "video" : "image";
  const label = nextCanvasNodeName(kind, existingLabels);
  if (kind === "video") {
    return {
      ...defaultVideoData(),
      label,
      resultUrl: item.mediaUrl,
      resultStoragePath: item.storagePath || null,
      creationId: item.id,
      imported: true,
    };
  }
  return {
    ...defaultImageData(),
    label,
    resultUrl: item.mediaUrl,
    resultStoragePath: item.storagePath || null,
    creationId: item.id,
    imported: true,
  };
}
