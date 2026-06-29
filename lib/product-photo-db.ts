import {
  MODEL_POSES,
  PHOTO_STYLES,
  ModelPoseId,
  PhotoStyleId,
  ProductPhotoHistoryItem,
} from "@/lib/product-photo";
import { insertUserCreation, listUserCreations } from "@/lib/creations-db";
import { CreationHistoryItem } from "@/lib/creations";

const POSE_BY_ID = Object.fromEntries(MODEL_POSES.map((p) => [p.id, p]));
const STYLE_BY_ID = Object.fromEntries(PHOTO_STYLES.map((s) => [s.id, s]));

function creationToProductPhotoItem(item: CreationHistoryItem): ProductPhotoHistoryItem {
  const poseId = (item.metadata.poseId as ModelPoseId) || "standing";
  const styleId = (item.metadata.styleId as PhotoStyleId) || "minimalist-studio";
  const pose = POSE_BY_ID[poseId];
  const style = STYLE_BY_ID[styleId];
  return {
    id: item.id,
    imageUrl: item.mediaUrl,
    poseId,
    styleId,
    poseLabel: (item.metadata.poseLabel as string) || pose?.label || poseId,
    styleLabel: (item.metadata.styleLabel as string) || style?.label || styleId,
    createdAt: item.createdAt,
    storagePath: item.storagePath,
  };
}

export async function insertProductPhotoGeneration(params: {
  userId: string;
  imageUrl: string;
  storagePath: string;
  poseId: ModelPoseId;
  styleId: PhotoStyleId;
  prompt?: string;
  title?: string;
  /** Tags the creation kind (e.g. "character") so the library can group/filter it. */
  creationKind?: string;
  /** User-given character name (Character creation mode). */
  characterName?: string;
  modelTier?: string;
  modelLabel?: string;
}): Promise<ProductPhotoHistoryItem> {
  const pose = POSE_BY_ID[params.poseId];
  const style = STYLE_BY_ID[params.styleId];
  const item = await insertUserCreation({
    userId: params.userId,
    tool: "product_photo",
    mediaType: "image",
    mediaUrl: params.imageUrl,
    storagePath: params.storagePath,
    title: params.title || `${pose?.label ?? params.poseId} · ${style?.label ?? params.styleId}`,
    metadata: {
      poseId: params.poseId,
      styleId: params.styleId,
      poseLabel: pose?.label,
      styleLabel: style?.label,
      ...(params.modelTier ? { modelTier: params.modelTier } : {}),
      ...(params.modelLabel ? { modelLabel: params.modelLabel } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
      ...(params.creationKind ? { creationKind: params.creationKind } : {}),
      ...(params.characterName ? { characterName: params.characterName } : {}),
    },
  });
  return creationToProductPhotoItem(item);
}

export async function listProductPhotoGenerationsForUser(
  userId: string,
  limit = 100
): Promise<ProductPhotoHistoryItem[]> {
  const items = await listUserCreations(userId, {
    tools: ["product_photo"],
    limit,
  });
  return items.map(creationToProductPhotoItem);
}
