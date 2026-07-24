/**
 * Kelolako uses one **private** Supabase Storage bucket (`krakatoa`) with signed read URLs.
 * User media lives under `{userId}/photos/` and `{userId}/videos/` so deleting one user is a
 * single top-level folder. Platform job outputs use `profiles/{profileId}/…` separately.
 *
 * Video studio: `{userId}/videos/generated/video/{mode}/` (reelscreator, t2v, i2v,
 * motion-control). Storyboard i2v: `{userId}/videos/generated/storyboard/`.
 * Product photos: `{userId}/photos/generated/{mode}/` (product, t2i, character,
 * storyboard). Reference uploads: `{userId}/photos/uploads/reference/`.
 * Scheduler device uploads: `{userId}/videos/uploads/scheduler/` (photos mirror under photos/).
 * Transient refs: `{userId}/videos/temp/refs/`.
 *
 * Legacy layout (`photos|videos/{userId}/…`) is still recognized by readers until
 * `npm run storage:migrate-user-first -- --execute` completes.
 *
 * Create the bucket in Supabase Dashboard → Storage (private). Reads via signed URLs.
 * Override the bucket name with SUPABASE_STORAGE_BUCKET in .env.local if needed.
 */
export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

/** Top-level folder for ReelsGen (.ass, .mp4) — legacy layout only */
export const VIDEOS_FOLDER = "videos";

/** Ephemeral ReelsGen assets (e.g. .ass passed to Rendi, then deleted) */
export const VIDEOS_TEMP_SEGMENT = "temp";

/** Transient generation reference uploads (first/last frame, ref images/videos/audios). */
export const VIDEOS_TEMP_REFS_SEGMENT = "refs";

/** Storyboard tab: legacy global `videos/storyboard/` */
export const VIDEOS_STORYBOARD_SEGMENT = "storyboard";

/** Top-level folder for Product Photo — legacy layout only */
export const PHOTOS_FOLDER = "photos";

/** Platform foundation prefix — not user media. */
export const PROFILES_FOLDER = "profiles";

/** Path segment that marks transient reference uploads (legacy or per-user). */
const TEMP_REFS_SEGMENT_PATH = `/${VIDEOS_TEMP_SEGMENT}/${VIDEOS_TEMP_REFS_SEGMENT}/`;

/** @deprecated Legacy global refs prefix — use `videosUserTempRefPath`. */
export const VIDEOS_TEMP_REFS_PREFIX = `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${VIDEOS_TEMP_REFS_SEGMENT}/`;

const USER_ID_SEGMENT = /^[a-zA-Z0-9-]+$/;
const LEGACY_MEDIA_PREFIX = new RegExp(`^(?:${PHOTOS_FOLDER}|${VIDEOS_FOLDER})/`);
const USER_FIRST_MEDIA_PREFIX = new RegExp(
  `^([a-zA-Z0-9-]+)/(?:${PHOTOS_FOLDER}|${VIDEOS_FOLDER})/`,
);

export function safeUserIdSegment(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("Invalid user id");
  return safe;
}

export type UserMediaFolder = typeof PHOTOS_FOLDER | typeof VIDEOS_FOLDER;

/** `{userId}/photos` or `{userId}/videos` */
export function userMediaPrefix(userId: string, media: UserMediaFolder): string {
  return `${safeUserIdSegment(userId)}/${media}`;
}

/** `photos` or `videos` segment inside a bucket-relative path, or null. */
export function storagePathMediaKind(path: string): UserMediaFolder | null {
  if (path.startsWith(`${PHOTOS_FOLDER}/`)) return PHOTOS_FOLDER;
  if (path.startsWith(`${VIDEOS_FOLDER}/`)) return VIDEOS_FOLDER;
  const m = path.match(/^([a-zA-Z0-9-]+)\/(photos|videos)\//);
  if (m?.[2] === PHOTOS_FOLDER || m?.[2] === VIDEOS_FOLDER) return m[2];
  return null;
}

/** Legacy `photos|videos/{userId}/…` or user-first `{userId}/photos|videos/…`. */
export function isStorageRelativePath(value: string): boolean {
  if (!value || value.includes("..")) return false;
  if (LEGACY_MEDIA_PREFIX.test(value)) return true;
  return USER_FIRST_MEDIA_PREFIX.test(value);
}

/** Extract owner userId from a storage path (new layout first, then legacy). */
export function storagePathOwnerUserId(path: string): string | null {
  const userFirst = path.match(USER_FIRST_MEDIA_PREFIX);
  if (userFirst?.[1]) return userFirst[1];
  const legacy = path.match(new RegExp(`^(?:${PHOTOS_FOLDER}|${VIDEOS_FOLDER})/([a-zA-Z0-9-]+)/`));
  return legacy?.[1] ?? null;
}

/** Whether a top-level bucket folder name is a user media root (UUID), not `profiles` etc. */
export function isUserMediaRootFolder(name: string): boolean {
  return USER_ID_SEGMENT.test(name) && name !== PROFILES_FOLDER;
}

/** Proxy URL path after `/api/tiktok-photos/` for a photo storage key. */
export function photoStoragePathToProxyRest(path: string): string | null {
  const userFirst = path.match(/^([a-zA-Z0-9-]+)\/photos\/(.+)$/);
  if (userFirst) return `${userFirst[1]}/${userFirst[2]}`;
  const legacy = path.match(new RegExp(`^${PHOTOS_FOLDER}/([a-zA-Z0-9-]+)/(.+)$`));
  if (legacy) return `${legacy[1]}/${legacy[2]}`;
  return null;
}

/** Reconstruct photo storage key from TikTok proxy segments `[userId, …rest]`. */
export function photoProxySegmentsToStoragePath(segments: string[]): string | null {
  if (!segments.length || !isUserMediaRootFolder(segments[0]!)) return null;
  const userId = segments[0]!;
  const rest = segments.slice(1).join("/");
  if (!rest) return null;
  return `${userMediaPrefix(userId, PHOTOS_FOLDER)}/${rest}`;
}

/** @deprecated Scheduler device uploads only — generations use `videosUserPrefix`. */
export function videosStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${filename}`;
}

/** @deprecated Legacy global temp — new generations use `videosUserTempPath`. */
export function videosTempStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${filename}`;
}

/** Storage prefix per authenticated user: `{userId}/videos`. */
export function videosUserPrefix(userId: string): string {
  return userMediaPrefix(userId, VIDEOS_FOLDER);
}

/** Video studio modes under `generated/video/` (sibling folders, one per tool). */
export type VideoStudioMode = "reelscreator" | "t2v" | "i2v" | "motion-control";

function safeModeSegment(mode: string, label: string): string {
  const safe = mode.replace(/[^a-z0-9-]/g, "");
  if (!safe) throw new Error(`Invalid ${label}: "${mode}"`);
  return safe;
}

/** `{userId}/videos/generated/video/{mode}/{filename}` */
export function videosGeneratedVideoPath(
  userId: string,
  mode: VideoStudioMode,
  filename: string,
): string {
  return `${videosUserPrefix(userId)}/generated/video/${safeModeSegment(mode, "video mode")}/${filename}`;
}

/** Storyboard tab i2v output: `{userId}/videos/generated/storyboard/{filename}` */
export function videosStoryboardVideoPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/generated/storyboard/${filename}`;
}

/** @deprecated Use `videosGeneratedVideoPath` with the correct mode. */
export function videosGeneratedPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/generated/${filename}`;
}

/** Scheduler device uploads: `{userId}/videos/uploads/scheduler/<filename>`. */
export function videosSchedulerUploadPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/uploads/scheduler/${filename}`;
}

/** Transient per-user files (captions, scratch): `{userId}/videos/temp/<filename>`. */
export function videosUserTempPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/${VIDEOS_TEMP_SEGMENT}/${filename}`;
}

/**
 * Transient generation reference uploads under `{userId}/videos/temp/refs/<filename>`.
 * Covered by the storage sweep AND explicitly removed by generation routes after run.
 */
export function videosUserTempRefPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}${TEMP_REFS_SEGMENT_PATH}${filename}`;
}

/** @deprecated Use `videosUserTempRefPath` — kept for call-site grep during migration. */
export function videosTempRefPath(filename: string): string {
  return `${VIDEOS_TEMP_REFS_PREFIX}${filename}`;
}

/** Whether a storage path lives under a transient reference-uploads folder. */
export function isVideosTempRefPath(path: string): boolean {
  if (typeof path !== "string" || !path.includes(TEMP_REFS_SEGMENT_PATH)) return false;
  return storagePathMediaKind(path) === VIDEOS_FOLDER || path.startsWith(`${VIDEOS_FOLDER}/`);
}

/** @deprecated Use `videosStoryboardVideoPath` or `storyboardSheetPath` (product-photo). */
export function videosUserStoryboardPath(userId: string, filename: string): string {
  return videosStoryboardVideoPath(userId, filename);
}

/** @deprecated Use `videosUserStoryboardPath` — legacy flat storyboard folder. */
export function videosStoryboardPath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_STORYBOARD_SEGMENT}/${filename}`;
}

/** True when a path is under any user's (or legacy global) `temp/` segment. */
export function isVideosTempPath(path: string): boolean {
  if (storagePathMediaKind(path) !== VIDEOS_FOLDER && !path.startsWith(`${VIDEOS_FOLDER}/`)) {
    return false;
  }
  if (path.startsWith(`${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/`)) return true;
  return path.includes(`/${VIDEOS_TEMP_SEGMENT}/`);
}

/** Postgres table for Storyboard metadata (public URLs only — never Replicate prediction URLs). */
export const STORYBOARDS_TABLE = "storyboards";

/** Postgres table for all tool outputs (one row per successful create, per user). */
export const USER_CREATIONS_TABLE = "user_creations";

/** @deprecated Use USER_CREATIONS_TABLE with tool=product_photo */
export const PRODUCT_PHOTO_GENERATIONS_TABLE = "product_photo_generations";

/** Storage prefix per authenticated user: `{userId}/photos`. */
export function photosUserPrefix(userId: string): string {
  return userMediaPrefix(userId, PHOTOS_FOLDER);
}

export function photosSchedulerUploadPath(userId: string, filename: string): string {
  return `${photosUserPrefix(userId)}/uploads/scheduler/${filename}`;
}

/** Legacy helper — prefer `photosUserPrefix` + segments for new code. */
export function photosStoragePath(...segments: string[]): string {
  return [PHOTOS_FOLDER, ...segments].join("/");
}

/**
 * Extract the storage-relative path from a Supabase public URL for this
 * project's bucket, e.g. "https://…/object/public/krakatoa/videos/x.mp4" →
 * "videos/x.mp4". Returns null for URLs that don't match this bucket.
 */
export function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length) || null;
}

/** Extract bucket-relative path from a signed read URL (`/object/sign/...`). */
export function storagePathFromSignedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/sign/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length).split("?")[0] || null;
}

/** Public or signed Supabase Storage URL → bucket-relative path. */
export function storagePathFromStorageUrl(url: string | null | undefined): string | null {
  return storagePathFromPublicUrl(url) ?? storagePathFromSignedUrl(url);
}

// NOTE: this module is imported by client components too (e.g. lib/product-photo.ts,
// transitively reachable from the dashboard). Keep it free of `lib/supabase-server`
// (or any other server-secret-touching import) — the Storage API-calling
// existence check lives in `lib/video-storage.ts` instead.

// ponytail: self-check — fails fast if path helpers drift
if (process.env.NODE_ENV !== "production") {
  const uid = "abc-123-def";
  const video = videosGeneratedVideoPath(uid, "t2v", "x.mp4");
  const photo = `${photosUserPrefix(uid)}/generated/product/y.png`;
  if (video !== `${uid}/videos/generated/video/t2v/x.mp4`) {
    throw new Error(`storage-buckets self-check failed: video path ${video}`);
  }
  if (!photo.endsWith("/generated/product/y.png")) {
    throw new Error(`storage-buckets self-check failed: photo path ${photo}`);
  }
  if (!isStorageRelativePath(video) || !isStorageRelativePath(photo)) {
    throw new Error("storage-buckets self-check failed: isStorageRelativePath");
  }
  if (storagePathOwnerUserId(video) !== uid || storagePathOwnerUserId(photo) !== uid) {
    throw new Error("storage-buckets self-check failed: storagePathOwnerUserId");
  }
  const legacy = `photos/${uid}/generated/product/z.png`;
  if (!isStorageRelativePath(legacy) || storagePathOwnerUserId(legacy) !== uid) {
    throw new Error("storage-buckets self-check failed: legacy layout");
  }
}
