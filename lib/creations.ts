export const CREATION_TOOLS = {
  product_photo: { label: "Product Photo", mediaType: "image" as const },
  reels_seedance: { label: "Reels (Seedance 2 Fast)", mediaType: "video" as const },
  reels_veo: { label: "Reels (Veo 3.1 Lite)", mediaType: "video" as const },
  storyboard: { label: "Storyboard", mediaType: "image" as const },
  storyboard_video: { label: "Storyboard Video", mediaType: "video" as const },
  video_text2video: { label: "Text to Video", mediaType: "video" as const },
  video_image2video: { label: "Image to Video", mediaType: "video" as const },
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

/** A creation tagged as a Character creation (turnaround sheet) in the omni-form. */
export function isCharacterItem(item: CreationHistoryItem): boolean {
  return item.metadata?.creationKind === "character";
}

/** A creation that has been soft-deleted (lives in Trash until purged). */
export function isTrashedItem(item: CreationHistoryItem): boolean {
  const deletedAt = item.metadata?.deletedAt;
  return typeof deletedAt === "string" && deletedAt.trim().length > 0;
}

/** Display name for a character creation (its given name, falling back to title). */
export function characterDisplayName(item: CreationHistoryItem): string {
  const name = item.metadata?.characterName;
  if (typeof name === "string" && name.trim()) return name.trim();
  return item.title || "Character";
}

export function parseToolsQuery(raw: string | null): CreationTool[] | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw.split(",").map((s) => s.trim());
  const valid = parts.filter((t): t is CreationTool => t in CREATION_TOOLS);
  return valid.length ? valid : undefined;
}
