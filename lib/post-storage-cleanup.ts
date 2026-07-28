import { supabaseServer } from "@/lib/supabase-server";
import { removeStorageObjects } from "@/lib/creations-db";
import { resolveStoragePath } from "@/lib/storage-signed-url";

/**
 * Best-effort: delete the video file from storage (only when the post has no
 * asset_id — asset-owned files must not be removed here) and null out
 * video_url on the post row. Logs but never throws — a storage failure must
 * not unwind a successful publish (or, for the failed-post safety net, must
 * not block reclaiming the rest of the batch).
 *
 * Shared by app/api/cron/route.ts (fires right after a confirmed publish)
 * and app/api/cron/cleanup-failed-posts/route.ts (fires for posts abandoned
 * in "failed" for a long time).
 */
export async function cleanupPostVideo(
  postId: string,
  videoUrl: string | null | undefined,
  assetId: string | null | undefined,
): Promise<void> {
  if (assetId) {
    // The file belongs to an asset row — deleting it here would break the
    // asset's public_url and the Reels Creator history gallery.
    console.log(`[post-cleanup] post ${postId} is asset-linked (asset_id=${assetId}) — skipping storage deletion`);
  } else {
    const path = resolveStoragePath(null, videoUrl);
    if (path) {
      await removeStorageObjects([path]);
      console.log(`[post-cleanup] storage object removed: ${path}`);
    } else if (videoUrl) {
      console.warn(`[post-cleanup] could not extract storage path from video_url: ${videoUrl}`);
    }
  }
  const { error } = await supabaseServer.from("posts").update({ video_url: null }).eq("id", postId);
  if (error) console.warn(`[post-cleanup] failed to null video_url for post ${postId}:`, error.message);
}

/**
 * Best-effort: delete only the raw-uploaded entries in `photo_urls` from
 * storage, then update the post's photo_urls to drop just those deleted
 * entries (keeping any that weren't). Photos have no per-entry asset_id
 * column the way a video post does, so the raw-upload-vs-asset-library
 * distinction is made by path shape instead: a raw scheduler upload always
 * lives under `{userId}/photos/uploads/scheduler/...` (see
 * photosSchedulerUploadPath in lib/storage-buckets.ts); anything else (e.g.
 * `{userId}/photos/generated/...` from Product Photo / Storyboard, picked
 * via "Choose from Assets") is left untouched — deleting it would break the
 * Product Photo history gallery. A single carousel can mix both kinds, so
 * this filters per-entry rather than all-or-nothing. Logs but never throws.
 */
export async function cleanupPostPhotos(postId: string, photoUrls: string[] | null | undefined): Promise<void> {
  if (!Array.isArray(photoUrls) || photoUrls.length === 0) return;

  const isRawUpload = (p: string) => p.includes("/uploads/scheduler/");
  const toDelete = photoUrls.filter(isRawUpload);
  const toKeep = photoUrls.filter((p) => !isRawUpload(p));

  if (toDelete.length === 0) {
    console.log(`[post-cleanup] post ${postId}: no raw-uploaded photos to clean up (all asset-linked)`);
    return;
  }

  await removeStorageObjects(toDelete);
  console.log(`[post-cleanup] storage objects removed for post ${postId}:`, toDelete);

  const { error } = await supabaseServer
    .from("posts")
    .update({ photo_urls: toKeep.length > 0 ? toKeep : null })
    .eq("id", postId);
  if (error) console.warn(`[post-cleanup] failed to update photo_urls for post ${postId}:`, error.message);
}
