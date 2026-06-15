import { getSupabase } from "@/lib/supabase";
import { supabaseServer } from "@/lib/supabase-server";
import { insertProductPhotoGeneration } from "@/lib/product-photo-db";
import { STORAGE_BUCKET, USER_CREATIONS_TABLE } from "@/lib/storage-buckets";
import {
  PRODUCT_PHOTO_BUCKET,
  ModelPoseId,
  PhotoStyleId,
  ProductPhotoHistoryItem,
  generatedPath,
  uploadsPath,
  userStoragePrefix,
  parseGeneratedFilename,
  historyItemFromPath,
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
  prompt?: string;
  title?: string;
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
    prompt: params.prompt,
    title: params.title,
  });

  return { storagePath, publicUrl, historyItem };
}

/**
 * Self-healing backfill: ensure every generated product photo already in
 * Storage has a matching `user_creations` row, so the "Your generations" feed
 * (which reads the DB) also surfaces photos created before the DB dual-write
 * existed or whose DB insert was lost. Idempotent and scoped to one user.
 *
 * Returns the number of rows inserted (0 when nothing was missing).
 */
export async function reconcileProductPhotosFromStorage(
  userId: string
): Promise<number> {
  const prefix = `${userStoragePrefix(userId)}/generated`;

  const { data: files, error: listError } = await storage().list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (listError || !files?.length) return 0;

  // Only files whose names encode a known pose/style are reconstructable.
  const candidates = files
    .filter((f) => f.name && parseGeneratedFilename(f.name))
    .map((f) => {
      const storagePath = `${prefix}/${f.name}`;
      const item = historyItemFromPath(storagePath, getPublicUrl(storagePath));
      return item ? { storagePath, item } : null;
    })
    .filter((c): c is { storagePath: string; item: ProductPhotoHistoryItem } => c !== null);
  if (!candidates.length) return 0;

  // Skip anything already recorded (dedupe by storage_path for this user).
  const { data: existing } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("storage_path")
    .eq("user_id", userId)
    .eq("tool", "product_photo")
    .in(
      "storage_path",
      candidates.map((c) => c.storagePath)
    );

  const recorded = new Set((existing ?? []).map((r) => r.storage_path as string));
  const missing = candidates.filter((c) => !recorded.has(c.storagePath));
  if (!missing.length) return 0;

  const rows = missing.map(({ storagePath, item }) => ({
    user_id: userId,
    tool: "product_photo",
    media_type: "image",
    media_url: item.imageUrl,
    storage_path: storagePath,
    title: `${item.poseLabel} · ${item.styleLabel}`,
    metadata: {
      poseId: item.poseId,
      styleId: item.styleId,
      poseLabel: item.poseLabel,
      styleLabel: item.styleLabel,
      backfilledFromStorage: true,
    },
    // Preserve the original creation time encoded in the filename so the feed
    // orders backfilled photos correctly instead of bunching them at "now".
    created_at: item.createdAt,
  }));

  const { error: insertError } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .insert(rows);

  // A concurrent reconcile may insert the same rows first; the partial unique
  // index on (user_id, storage_path) then rejects this batch. That's the
  // intended outcome — treat the duplicate-key race as a successful no-op.
  if (insertError) {
    const isDuplicate =
      insertError.code === "23505" ||
      /duplicate key|unique constraint/i.test(insertError.message);
    if (!isDuplicate) throw new Error(insertError.message);
    return 0;
  }

  return rows.length;
}
