import { getSupabase } from "@/lib/supabase";
import { insertProductPhotoGeneration } from "@/lib/product-photo-db";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";
import {
  PRODUCT_PHOTO_BUCKET,
  ModelPoseId,
  PhotoStyleId,
  ProductPhotoHistoryItem,
  generatedPath,
  uploadsPath,
} from "@/lib/product-photo";

function storage() {
  return getSupabase().storage.from(PRODUCT_PHOTO_BUCKET);
}

export function getPublicUrl(storagePath: string): string {
  const { data } = storage().getPublicUrl(storagePath);
  return data.publicUrl;
}

function wrapStorageError(action: string, error: { message: string }) {
  const hint =
    error.message === "fetch failed"
      ? ` Check NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (JWT only), and that the public bucket "${STORAGE_BUCKET}" exists.`
      : "";
  throw new Error(`${action}: ${error.message}${hint}`);
}

export async function uploadProductReferenceImage(
  userId: string,
  file: File
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const filename = `${Date.now()}_upload.${safeExt}`;
  const storagePath = uploadsPath(userId, filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await storage().upload(storagePath, buffer, {
    contentType: file.type || `image/${safeExt === "jpg" ? "jpeg" : safeExt}`,
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    wrapStorageError("Failed to upload product image", error);
  }

  return { storagePath, publicUrl: getPublicUrl(storagePath) };
}

export async function saveGeneratedProductPhoto(params: {
  userId: string;
  filename: string;
  imageBuffer: ArrayBuffer;
  poseId: ModelPoseId;
  styleId: PhotoStyleId;
  contentType?: string;
}): Promise<{ storagePath: string; publicUrl: string; historyItem: ProductPhotoHistoryItem }> {
  const storagePath = generatedPath(params.userId, params.filename);

  const { error } = await storage().upload(storagePath, params.imageBuffer, {
    contentType: params.contentType ?? "image/png",
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    wrapStorageError("Failed to save generated image", error);
  }

  const publicUrl = getPublicUrl(storagePath);
  const historyItem = await insertProductPhotoGeneration({
    userId: params.userId,
    imageUrl: publicUrl,
    storagePath,
    poseId: params.poseId,
    styleId: params.styleId,
  });

  return { storagePath, publicUrl, historyItem };
}
