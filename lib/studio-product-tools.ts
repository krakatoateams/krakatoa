import type { CreationTool } from "@/lib/creations";

/**
 * Product ↔ API alignment for the studio history UI.
 *
 * Photo studio: every composer posts to POST /api/generate-photo (`mode` selects
 * the pipeline — storyboard included).
 *
 * Video studio: every composer belongs to the generate-video family
 * (t2v/i2v/viral on /api/generate-video; motion control, storyboard-to-video,
 * and reels on sibling routes until merged).
 */

/** Canonical tool for rows created by the Photo studio / generate-photo product. */
export const PHOTO_STUDIO_TOOL: CreationTool = "product_photo";

/** Tools written by POST /api/generate-video today (t2v, i2v, viral template). */
export const GENERATE_VIDEO_TOOLS: CreationTool[] = [
  "video_text2video",
  "video_image2video",
];

/** Every tool the Video studio history should surface together. */
export const VIDEO_STUDIO_TOOLS: CreationTool[] = [
  "video_text2video",
  "video_image2video",
  "video_motion_control",
  "storyboard_video",
  "reels_seedance",
  "reels_veo",
];

export function isGenerateVideoTool(tool: CreationTool): boolean {
  return GENERATE_VIDEO_TOOLS.includes(tool);
}

/** Expand generate-video tools to the full Video studio set for history queries. */
export function expandVideoStudioHistoryTools(
  tools?: CreationTool[]
): CreationTool[] | undefined {
  if (!tools?.length) return tools;
  if (!tools.some((t) => isGenerateVideoTool(t))) return tools;
  return [...new Set([...tools, ...VIDEO_STUDIO_TOOLS])];
}

export function usesPhotoStudioProduct(tools?: CreationTool[]): boolean {
  return Boolean(tools?.includes(PHOTO_STUDIO_TOOL));
}

export function usesVideoStudioProduct(tools?: CreationTool[]): boolean {
  if (!tools?.length) return false;
  return tools.some((t) => VIDEO_STUDIO_TOOLS.includes(t) || isGenerateVideoTool(t));
}
