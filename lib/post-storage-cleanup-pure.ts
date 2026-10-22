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

export function isSchedulerRawUpload(path: string): boolean {
  return path.includes("/uploads/scheduler/");
}

/**
 * Whether post cleanup may delete a post's source file. Only the Scheduler's
 * own raw device uploads (`{userId}/{videos|photos}/uploads/scheduler/…`) are
 * ever reclaimed — a file picked from My Library / handed off from a tool is
 * the library's own copy, and deleting it left blank library tiles (#385).
 * Even a raw upload stays while another post (multi-platform scheduling) or a
 * library row still points at it.
 */
export function postSourceDeletable(input: {
  path: string;
  otherPostRefs: number;
  libraryRefs: number;
}): boolean {
  return isSchedulerRawUpload(input.path) && input.otherPostRefs === 0 && input.libraryRefs === 0;
}

/** Sibling written by TikTok JPEG conversion (`foo.png` → `foo.tiktok.jpg`). */
export function convertedTikTokSiblingPath(sourcePath: string): string {
  return `${sourcePath.replace(/\.[^./]+$/, "")}.tiktok.jpg`;
}

export function storageCleanupPaths(sourcePaths: string[]): string[] {
  const out = new Set<string>();
  for (const path of sourcePaths) {
    out.add(path);
    out.add(convertedTikTokSiblingPath(path));
  }
  return [...out];
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
    isSchedulerRawUpload("u1/photos/uploads/scheduler/shot.jpg") === true,
    "scheduler raw uploads are reclaimable",
  );
  assert(
    isSchedulerRawUpload("u1/photos/generated/product/shot.jpg") === false,
    "library photos must not be deleted",
  );
  assert(
    convertedTikTokSiblingPath("u1/photos/uploads/scheduler/shot.png") ===
      "u1/photos/uploads/scheduler/shot.tiktok.jpg",
    "cleanup must know the converted TikTok JPEG sibling",
  );
  assert(
    storageCleanupPaths(["u1/photos/uploads/scheduler/shot.png"]).join(",") ===
      "u1/photos/uploads/scheduler/shot.png,u1/photos/uploads/scheduler/shot.tiktok.jpg",
    "photo cleanup must also remove the converted TikTok sibling",
  );
  // ── Which post source files may be deleted (#385) ──────────────────────
  const free = { otherPostRefs: 0, libraryRefs: 0 };
  assert(
    postSourceDeletable({ path: "u1/videos/uploads/scheduler/clip.mp4", ...free }) === true,
    "a raw scheduler video upload nothing else uses is reclaimable",
  );
  assert(
    postSourceDeletable({ path: "u1/videos/generated/reels/clip.mp4", ...free }) === false,
    "a library video (picked from My Assets / a tool hand-off) is never deleted by post cleanup",
  );
  assert(
    postSourceDeletable({ path: "u1/photos/generated/product/shot.jpg", ...free }) === false,
    "a library photo is never deleted by post cleanup",
  );
  assert(
    postSourceDeletable({ path: "u1/videos/uploads/scheduler/clip.mp4", otherPostRefs: 1, libraryRefs: 0 }) === false,
    "a video shared with another post (TikTok + YouTube) stays until the last post is done with it",
  );
  assert(
    postSourceDeletable({ path: "u1/videos/uploads/scheduler/clip.mp4", otherPostRefs: 0, libraryRefs: 1 }) === false,
    "anything a library row points at is never deleted",
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
