import type { CreationTool } from "@/lib/creations";
import type { PhotoStudioMode } from "@/lib/product-photo";
import {
  PHOTO_STUDIO_TOOL,
  expandVideoStudioHistoryTools,
  isGenerateVideoTool,
  usesPhotoStudioProduct,
  VIDEO_STUDIO_TOOLS,
} from "@/lib/studio-product-tools";

export {
  expandVideoStudioHistoryTools,
  GENERATE_VIDEO_TOOLS,
  PHOTO_STUDIO_TOOL,
  VIDEO_STUDIO_TOOLS,
} from "@/lib/studio-product-tools";

export type ProductMediaScope = "photo" | "video";

/** Top-level library product filter (includes combined "all" view). */
export type MediaScope = "all" | ProductMediaScope;

export function isProductMediaScope(scope: MediaScope): scope is ProductMediaScope {
  return scope === "photo" || scope === "video";
}

/** Utility tabs shared by both products (not a creation type). */
export type LibraryUtilityFeatureId = "favorite" | "trash";

export type PhotoLibraryFeatureId =
  | "all"
  | "generate-any-image"
  | "product-tryon"
  | "character"
  | "storyboard"
  | "social-post";

export type VideoLibraryFeatureId =
  | "all"
  | "text2video"
  | "image2video"
  | "viral_template"
  | "motion_control"
  | "storyboard"
  | "reels-creator";

export type LibraryFeatureId =
  | PhotoLibraryFeatureId
  | VideoLibraryFeatureId
  | LibraryUtilityFeatureId;

export type LibraryFeatureDef = {
  id: LibraryFeatureId;
  label: string;
};

export const PHOTO_LIBRARY_FEATURES: LibraryFeatureDef[] = [
  { id: "all", label: "All" },
  { id: "generate-any-image", label: "Generate any image" },
  { id: "product-tryon", label: "Product try-on" },
  { id: "character", label: "Character creation" },
  { id: "storyboard", label: "Storyboard" },
  { id: "social-post", label: "Social media post" },
];

/** Matches the Video studio creation-type chip (user-facing labels). */
export const VIDEO_LIBRARY_FEATURES: LibraryFeatureDef[] = [
  { id: "all", label: "All" },
  { id: "text2video", label: "Text to video" },
  { id: "image2video", label: "Image to video" },
  { id: "viral_template", label: "Viral Template" },
  { id: "motion_control", label: "Motion control" },
  { id: "storyboard", label: "Storyboard to video" },
  { id: "reels-creator", label: "Reels Creator" },
];

export const LIBRARY_UTILITY_FEATURES: LibraryFeatureDef[] = [
  { id: "favorite", label: "Favorites" },
  { id: "trash", label: "Trash" },
];

export function libraryFeaturesForScope(scope: ProductMediaScope): LibraryFeatureDef[] {
  return scope === "photo" ? PHOTO_LIBRARY_FEATURES : VIDEO_LIBRARY_FEATURES;
}

/** Drop feature chips that can never match the outer `tools` filter (tool-embedded history). */
export function libraryFeaturesForScopeAndTools(
  scope: ProductMediaScope,
  tools?: CreationTool[]
): LibraryFeatureDef[] {
  const features = libraryFeaturesForScope(scope);
  if (!tools?.length) return features;
  return features.filter((feature) => {
    if (feature.id === "all") return true;
    if (scope === "photo" && usesPhotoStudioProduct(tools)) return true;
    if (scope === "video" && tools.some((t) => isGenerateVideoTool(t))) return true;
    const query = libraryQueryFromFeature(scope, feature.id);
    if (!query?.tools?.length) return true;
    return query.tools.some((t) => tools.includes(t));
  });
}

/** Server-side listing/count filters for one library feature chip. */
export type CreationLibraryQuery = {
  tools?: CreationTool[];
  mediaType?: "image" | "video";
  kind?: string;
  photoMode?: PhotoStudioMode;
  viralTemplate?: "only" | "exclude";
  trashed?: boolean;
  /** Photo studio “All” — generate-photo rows + storyboard sheets (same product). */
  photoStudioAll?: boolean;
  /** Video studio “All” — every video composer output. */
  videoStudioAll?: boolean;
};

export function libraryQueryFromFeature(
  scope: ProductMediaScope,
  featureId: LibraryFeatureId
): CreationLibraryQuery | null {
  if (featureId === "favorite") return null;
  if (featureId === "trash") return { trashed: true };

  if (scope === "photo") {
    switch (featureId as PhotoLibraryFeatureId) {
      case "all":
        return { mediaType: "image", photoStudioAll: true };
      case "generate-any-image":
        return { tools: [PHOTO_STUDIO_TOOL], mediaType: "image", photoMode: "t2i" };
      case "product-tryon":
        return { tools: [PHOTO_STUDIO_TOOL], mediaType: "image", photoMode: "product" };
      case "character":
        return { tools: [PHOTO_STUDIO_TOOL], mediaType: "image", kind: "character" };
      case "storyboard":
        return { mediaType: "image", photoMode: "storyboard" };
      case "social-post":
        return { tools: [PHOTO_STUDIO_TOOL], mediaType: "image", kind: "social_post" };
      default:
        return { mediaType: "image" };
    }
  }

  switch (featureId as VideoLibraryFeatureId) {
    case "all":
      return { mediaType: "video", videoStudioAll: true };
    case "text2video":
      return { tools: ["video_text2video"], mediaType: "video" };
    case "image2video":
      return {
        tools: ["video_image2video"],
        mediaType: "video",
        viralTemplate: "exclude",
      };
    case "viral_template":
      return {
        tools: ["video_image2video"],
        mediaType: "video",
        viralTemplate: "only",
      };
    case "motion_control":
      return { tools: ["video_motion_control"], mediaType: "video" };
    case "storyboard":
      return { tools: ["storyboard_video"], mediaType: "video" };
    case "reels-creator":
      return { tools: ["reels_seedance", "reels_veo"], mediaType: "video" };
    default:
      return { mediaType: "video" };
  }
}

export type LibraryFeatureCounts = {
  photo: Record<PhotoLibraryFeatureId, number>;
  video: Record<VideoLibraryFeatureId, number>;
  trash: number;
};

export const PHOTO_LIBRARY_FEATURE_IDS = PHOTO_LIBRARY_FEATURES.map(
  (f) => f.id
) as PhotoLibraryFeatureId[];

export const VIDEO_LIBRARY_FEATURE_IDS = VIDEO_LIBRARY_FEATURES.map(
  (f) => f.id
) as VideoLibraryFeatureId[];
