/**
 * Supabase Storage helpers for the reels pipeline. Captions are uploaded to a
 * transient `videos/{userId}/temp/` path so Rendi can fetch them by URL, then removed
 * after a successful run. The final MP4 is downloaded from Rendi and re-uploaded
 * under `videos/{userId}/generated/video/{mode}/`.
 */
import { uploadToResumable } from "@/lib/pipeline-recovery/storage";
import { signStoragePathForPipeline } from "@/lib/storage-signed-url";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
  type VideoStudioMode,
  videosUserTempPath,
} from "@/lib/storage-buckets";

/** Upload captions to resumable staging for recovery-aware pipelines. */
export async function uploadAssCaptionsResumable(
  userId: string,
  jobId: string,
  assContent: string,
): Promise<{ storagePath: string; signedUrl: string }> {
  const storagePath = await uploadToResumable(
    userId,
    jobId,
    "captions.ass",
    assContent,
    "text/plain",
  );
  const signedUrl = await signStoragePathForPipeline(storagePath, userId);
  return { storagePath, signedUrl };
}

/** Upload an .ass caption file and return its transient path + public URL. */
export async function uploadAssCaptions(
  userId: string,
  assContent: string,
  filename: string
): Promise<{ srtFilename: string; srtUrl: string }> {
  const srtFilename = videosUserTempPath(userId, filename);
  const { error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(srtFilename, assContent, {
      contentType: "text/plain",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
  if (error) {
    console.error("Supabase caption upload error:", error);
    throw new Error("Failed to upload captions to storage");
  }
  const srtUrl = await signStoragePathForPipeline(srtFilename, userId);
  return { srtFilename, srtUrl };
}

/** Download the finished video from Rendi and upload it to Supabase. */
export async function downloadAndStoreFinal(
  userId: string,
  mode: VideoStudioMode,
  rendiUrl: string,
  filename: string
): Promise<{ storagePath: string; publicUrl: string; signedUrl: string }> {
  const resp = await fetch(rendiUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download video from Rendi: ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  const storagePath = videosGeneratedVideoPath(userId, mode, filename);
  const { error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload final video to Supabase: ${error.message}`);
  }
  const signedUrl = await signStoragePathForPipeline(storagePath, userId);
  return { storagePath, publicUrl: signedUrl, signedUrl };
}

/** Best-effort removal of the transient caption file (never throws). */
export async function cleanupCaptions(srtFilename: string): Promise<void> {
  try {
    await supabaseServer.storage.from(STORAGE_BUCKET).remove([srtFilename]);
  } catch (e) {
    console.warn("[reels-pipeline] caption cleanup (non-fatal):", e);
  }
}
