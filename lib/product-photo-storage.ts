import { getSupabase } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";
import {
  PRODUCT_PHOTO_BUCKET,
  ProductPhotoHistoryItem,
  clientStoragePrefix,
  generatedPath,
  historyItemFromPath,
  parseGeneratedFilename,
  uploadsPath,
} from "@/lib/product-photo";
import { appendManifestItem, readManifest } from "@/lib/product-photo-history-store";

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

export async function uploadProductPhotoFile(
  clientId: string,
  file: File
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const filename = `${Date.now()}_upload.${safeExt}`;
  const storagePath = uploadsPath(clientId, filename);
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

export async function uploadGeneratedImage(
  clientId: string,
  filename: string,
  imageBuffer: ArrayBuffer,
  contentType = "image/png"
): Promise<{
  storagePath: string;
  publicUrl: string;
  historyItem: ProductPhotoHistoryItem | null;
}> {
  const storagePath = generatedPath(clientId, filename);

  const { error } = await storage().upload(storagePath, imageBuffer, {
    contentType,
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    wrapStorageError("Failed to save generated image", error);
  }

  const publicUrl = getPublicUrl(storagePath);
  const historyItem = historyItemFromPath(storagePath, publicUrl);
  if (historyItem) {
    try {
      await appendManifestItem(clientId, historyItem);
    } catch (manifestErr) {
      console.warn("[Product Photo] Manifest update failed:", manifestErr);
    }
  }

  return { storagePath, publicUrl, historyItem };
}

export async function listProductPhotoHistory(clientId: string): Promise<ProductPhotoHistoryItem[]> {
  const manifestItems = await readManifest(clientId);
  if (manifestItems.length > 0) {
    return manifestItems;
  }

  // Fallback: scan storage folder (older uploads without manifest)
  const prefix = `${clientStoragePrefix(clientId)}/generated`;
  const { data: files, error } = await storage().list(prefix, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    wrapStorageError("Failed to load history", error);
  }

  const items: ProductPhotoHistoryItem[] = [];

  for (const file of files || []) {
    if (!file.name || file.name === ".emptyFolderPlaceholder") continue;
    const storagePath = `${prefix}/${file.name}`;
    const publicUrl = getPublicUrl(storagePath);
    const item = historyItemFromPath(storagePath, publicUrl);
    if (item) items.push(item);
    else if (parseGeneratedFilename(file.name)) {
      // Include file even if metadata parse partially fails
      items.push({
        id: file.name.replace(/\.[^.]+$/, ""),
        imageUrl: publicUrl,
        poseId: "standing",
        styleId: "minimalist-studio",
        poseLabel: "Generated",
        styleLabel: "Photo",
        createdAt: new Date(file.created_at || Date.now()).toISOString(),
        storagePath,
      });
    }
  }

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
