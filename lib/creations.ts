export const CREATION_TOOLS = {
  product_photo: { label: "Product Photo", mediaType: "image" as const },
  reels_seedance: { label: "Reels (Seedance)", mediaType: "video" as const },
  reels_veo: { label: "Reels (Veo)", mediaType: "video" as const },
  storyboard: { label: "Storyboard", mediaType: "image" as const },
  storyboard_video: { label: "Storyboard Video", mediaType: "video" as const },
  video_text2video: { label: "Text to Video", mediaType: "video" as const },
  video_motion_control: { label: "Motion Control", mediaType: "video" as const },
} as const;

export type CreationTool = keyof typeof CREATION_TOOLS;

export type CreationHistoryItem = {
  id: string;
  tool: CreationTool;
  toolLabel: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  storagePath: string;
  title: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export function parseToolsQuery(raw: string | null): CreationTool[] | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw.split(",").map((s) => s.trim());
  const valid = parts.filter((t): t is CreationTool => t in CREATION_TOOLS);
  return valid.length ? valid : undefined;
}
