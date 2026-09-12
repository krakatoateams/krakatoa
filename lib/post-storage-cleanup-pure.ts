/**
 * Failed-post storage cleanup predicates. Pure — no Supabase.
 */

import { redactPublishMediaRef } from "@/lib/tiktok-publish-pure";

/**
 * Shared by post-publish cleanup (status already `published`) and the
 * failed-post safety net. Re-armed `scheduled` rows must not lose media.
 */
export const POST_CLEANUP_RECLAIM_STATUSES = ["failed", "published"] as const;

export function postCleanupMayReclaim(status: string): boolean {
  return (POST_CLEANUP_RECLAIM_STATUSES as readonly string[]).includes(status);
}

export function isSchedulerRawPhotoUpload(path: string): boolean {
  return path.includes("/uploads/scheduler/");
}

export function cleanupLogVideoRef(videoUrl: string): string {
  return redactPublishMediaRef(videoUrl);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`post-storage-cleanup self-check: ${message}`);
}

export function postStorageCleanupSelfCheck(): void {
  assert(
    postCleanupMayReclaim("scheduled") === false,
    "re-armed posts must not lose source media to failed-post cleanup",
  );
  assert(
    postCleanupMayReclaim("failed") === true,
    "abandoned failed posts may be cleaned",
  );
  assert(
    postCleanupMayReclaim("published") === true,
    "confirmed publish cleanup may still reclaim source media",
  );
  assert(
    isSchedulerRawPhotoUpload("u1/photos/uploads/scheduler/shot.jpg") === true,
    "scheduler raw uploads are reclaimable",
  );
  assert(
    isSchedulerRawPhotoUpload("u1/photos/generated/product/shot.jpg") === false,
    "library photos must not be deleted",
  );
  const signed =
    "https://example.supabase.co/storage/v1/object/sign/krakatoa/u1/videos/clip.mp4?token=secret-jwt";
  assert(
    !cleanupLogVideoRef(signed).includes("secret-jwt") &&
      !cleanupLogVideoRef(signed).includes("token="),
    "cleanup logs must not include signed URL tokens",
  );
}

if (require.main === module) {
  postStorageCleanupSelfCheck();
  console.log("post-storage-cleanup self-check passed");
}
