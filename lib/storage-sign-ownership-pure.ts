/**
 * Pure ownership predicates for read-signing.
 * A stored URL references a path only when it is that path, not a substring.
 */
import {
  isStorageRelativePath,
  storagePathFromStorageUrl,
  storagePathOwnerUserId,
} from "@/lib/storage-buckets";

export type PublishPhotoRef =
  | { ok: true; path: string }
  | { ok: false; reason: "unresolved" | "unowned" };

/** Prefix ownership for a photo path or hosted URL before publish-signing. */
export function classifyPublishPhotoRef(raw: string, userId: string): PublishPhotoRef {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "unresolved" };
  const path = isStorageRelativePath(trimmed)
    ? trimmed
    : storagePathFromStorageUrl(trimmed);
  if (!path) return { ok: false, reason: "unresolved" };
  if (!pathPrefixOwnedByUser(path, userId)) return { ok: false, reason: "unowned" };
  return { ok: true, path };
}

export function pathPrefixOwnedByUser(path: string, userId: string): boolean {
  return storagePathOwnerUserId(path) === userId;
}

/**
 * True when a DB field (path or hosted URL) is the requested storage key.
 * Substring matches are not ownership — a signed URL for
 * `{user}/videos/…/video_1.mp4` must not grant `videos/…/video_1.mp4`.
 */
export function storedValueReferencesPath(stored: string, path: string): boolean {
  const value = stored.trim();
  if (!value || !path) return false;
  if (value === path) return true;
  if (isStorageRelativePath(value)) return false;
  return storagePathFromStorageUrl(value) === path;
}

export function rowReferencesStoragePath(
  path: string,
  row: {
    storage_path?: string | null;
    media_url?: string | null;
    storyboard_url?: string | null;
    video_url?: string | null;
  },
): boolean {
  for (const field of [row.storage_path, row.media_url, row.storyboard_url, row.video_url]) {
    if (field && storedValueReferencesPath(field, path)) return true;
  }
  return false;
}
