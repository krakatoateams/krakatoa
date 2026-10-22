import { supabaseServer } from "@/lib/supabase-server";
import { removeStorageObjects } from "@/lib/creations-db";
import { resolveStoragePath } from "@/lib/storage-signed-url";
import { errorLogSafe } from "@/lib/error-log-safe";
import {
  POST_CLEANUP_RECLAIM_STATUSES,
  cleanupLogVideoRef,
  isSchedulerRawUpload,
  postSourceDeletable,
  storageCleanupPaths,
} from "@/lib/post-storage-cleanup-pure";

/** PostgREST filter value, quoted so path characters can't break the filter. */
const pgValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Who else still points at a storage path: other posts (multi-platform
 * scheduling shares one upload) and library rows. Null when the lookup fails —
 * callers then keep the file (fail safe).
 */
async function sourceReferences(
  postId: string,
  path: string,
  rawRef?: string | null,
): Promise<{ otherPostRefs: number; libraryRefs: number } | null> {
  const postMatches = [`video_url.eq.${pgValue(path)}`, `photo_urls.cs.{${pgValue(path)}}`];
  if (rawRef && rawRef !== path) postMatches.push(`video_url.eq.${pgValue(rawRef)}`);

  const [posts, library] = await Promise.all([
    supabaseServer
      .from("posts")
      .select("id", { head: true, count: "exact" })
      .neq("id", postId)
      .or(postMatches.join(",")),
    supabaseServer
      .from("user_creations")
      .select("id", { head: true, count: "exact" })
      .eq("storage_path", path),
  ]);
  if (posts.error || library.error) {
    console.warn(
      `[post-cleanup] reference check failed for post ${postId} — keeping the file:`,
      errorLogSafe(posts.error ?? library.error),
    );
    return null;
  }
  return { otherPostRefs: posts.count ?? 0, libraryRefs: library.count ?? 0 };
}

/** True when `path` may be deleted for this post (see postSourceDeletable). */
async function mayDeleteSource(postId: string, path: string, rawRef?: string | null): Promise<boolean> {
  if (!isSchedulerRawUpload(path)) return false; // library media: never, skip the lookup
  const refs = await sourceReferences(postId, path, rawRef);
  return refs !== null && postSourceDeletable({ path, ...refs });
}

/**
 * Best-effort: null out video_url on the post row and delete the video file
 * from storage — only when it's the Scheduler's own raw upload that no other
 * post or library row still uses (postSourceDeletable; #385), and the post has
 * no asset_id. Logs but never throws — a storage failure must
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
  const { data: abandoned, error: claimErr } = await supabaseServer
    .from("posts")
    .update({ video_url: null })
    .eq("id", postId)
    .in("status", [...POST_CLEANUP_RECLAIM_STATUSES])
    .select("id")
    .maybeSingle();
  if (claimErr) {
    console.warn(
      `[post-cleanup] failed to null video_url for post ${postId}:`,
      errorLogSafe(claimErr)
    );
    return;
  }
  if (!abandoned) {
    console.log(`[post-cleanup] post ${postId} is no longer failed or published — skipping video cleanup`);
    return;
  }

  if (assetId) {
    // The file belongs to an asset row — deleting it here would break the
    // asset's public_url and the Reels Creator history gallery.
    console.log(`[post-cleanup] post ${postId} is asset-linked (asset_id=${assetId}) — skipping storage deletion`);
    return;
  }
  const path = resolveStoragePath(null, videoUrl);
  if (path) {
    if (!(await mayDeleteSource(postId, path, videoUrl))) {
      console.log(`[post-cleanup] post ${postId}: keeping ${path} (library media or still in use)`);
      return;
    }
    await removeStorageObjects([path]);
    console.log(`[post-cleanup] storage object removed: ${path}`);
  } else if (videoUrl) {
    console.warn(
      `[post-cleanup] could not extract storage path from video_url: ${cleanupLogVideoRef(videoUrl)}`,
    );
  }
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

  const toDelete = photoUrls.filter(isSchedulerRawUpload);
  const toKeep = photoUrls.filter((p) => !isSchedulerRawUpload(p));

  if (toDelete.length === 0) {
    console.log(`[post-cleanup] post ${postId}: no raw-uploaded photos to clean up (all asset-linked)`);
    return;
  }

  const { data: abandoned, error } = await supabaseServer
    .from("posts")
    .update({ photo_urls: toKeep.length > 0 ? toKeep : null })
    .eq("id", postId)
    .in("status", [...POST_CLEANUP_RECLAIM_STATUSES])
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn(
      `[post-cleanup] failed to update photo_urls for post ${postId}:`,
      errorLogSafe(error)
    );
    return;
  }
  if (!abandoned) {
    console.log(`[post-cleanup] post ${postId} is no longer failed or published — skipping photo cleanup`);
    return;
  }

  // A raw upload can still be shared with another post; only delete the ones
  // nothing else uses (the row above already dropped them from this post).
  const deletable: string[] = [];
  for (const path of toDelete) {
    if (await mayDeleteSource(postId, path)) deletable.push(path);
  }
  if (deletable.length === 0) {
    console.log(`[post-cleanup] post ${postId}: raw photos still in use elsewhere — nothing deleted`);
    return;
  }
  const paths = storageCleanupPaths(deletable);
  await removeStorageObjects(paths);
  console.log(`[post-cleanup] storage objects removed for post ${postId}:`, paths);
}
