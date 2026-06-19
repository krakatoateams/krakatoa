/**
 * Supabase Storage helpers for the reels pipeline. Captions are uploaded to a
 * transient `videos/temp/` path so Rendi can fetch them by URL, then removed
 * after a successful run. The final MP4 is downloaded from Rendi and re-uploaded
 * to `videos/` as the public deliverable.
 */
import { supabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  videosStoragePath,
  videosTempStoragePath,
} from "@/lib/storage-buckets";

/** Upload an .ass caption file and return its transient path + public URL. */
export async function uploadAssCaptions(
  assContent: string,
  filename: string
): Promise<{ srtFilename: string; srtUrl: string }> {
  const srtFilename = videosTempStoragePath(filename);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(srtFilename, assContent, {
      contentType: "text/plain",
      cacheControl: "3600",
      upsert: false,
    });
  if (error) {
    console.error("Supabase caption upload error:", error);
    throw new Error("Failed to upload captions to storage");
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(srtFilename);
  return { srtFilename, srtUrl: publicUrl };
}

/** Download the finished video from Rendi and upload it to Supabase. */
export async function downloadAndStoreFinal(
  rendiUrl: string,
  filename: string
): Promise<{ storagePath: string; publicUrl: string }> {
  const resp = await fetch(rendiUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download video from Rendi: ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  const storagePath = videosStoragePath(filename);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      cacheControl: "3600",
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload final video to Supabase: ${error.message}`);
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return { storagePath, publicUrl };
}

/** Best-effort removal of the transient caption file (never throws). */
export async function cleanupCaptions(srtFilename: string): Promise<void> {
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([srtFilename]);
  } catch (e) {
    console.warn("[reels-pipeline] caption cleanup (non-fatal):", e);
  }
}
