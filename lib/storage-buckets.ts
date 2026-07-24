/**
 * Kelolako uses one public Supabase Storage bucket with top-level folders per feature.
 * Product photos live under `photos/{userId}/` — never inside `videos/`.
 * Video studio: `videos/{userId}/generated/video/{mode}/` (reelscreator, t2v, i2v,
 * motion-control). Storyboard i2v: `videos/{userId}/generated/storyboard/`.
 * Product photos: `photos/{userId}/generated/{mode}/` (product, t2i, character,
 * storyboard). Reference uploads: `photos/{userId}/uploads/reference/`.
 * Scheduler device uploads still use flat `videos/` (orphan-sweeped after 24h).
 *
 * Create the bucket in Supabase Dashboard → Storage, then add public folders as needed.
 * Override the bucket name with SUPABASE_STORAGE_BUCKET in .env.local if needed.
 *
 * ---------------------------------------------------------------------------
 * Storyboard gallery DB (run in Supabase SQL Editor — not applied by this repo)
 * ---------------------------------------------------------------------------
 *
 * create table storyboards (
 *   id uuid default gen_random_uuid() primary key,
 *   created_at timestamptz default now(),
 *   theme text not null,
 *   storyboard_url text not null,
 *   seedance_prompt text not null,
 *   scene_breakdown jsonb not null,
 *   status text default 'ready',
 *   video_url text
 * );
 *
 * alter table storyboards enable row level security;
 *
 * -- Browser gallery (anon key): read-only
 * create policy "storyboards_select_public" on storyboards for select using (true);
 *
 * -- Service role (API routes) bypasses RLS for insert/update.
 *
 * Creation history (run in Supabase SQL Editor):
 *   supabase/migrations/002_user_creations.sql
 *   (optional legacy) 001_product_photo_generations.sql
 * ---------------------------------------------------------------------------
 */
export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

/** Top-level folder for ReelsGen (.ass, .mp4) */
export const VIDEOS_FOLDER = "videos";

/** Ephemeral ReelsGen assets (e.g. .ass passed to Rendi, then deleted) */
export const VIDEOS_TEMP_SEGMENT = "temp";

/** Transient generation reference uploads (first/last frame, ref images/videos/audios). */
export const VIDEOS_TEMP_REFS_SEGMENT = "refs";

/** Storyboard tab: GPT Image outputs + Seedance finals under `videos/storyboard/` */
export const VIDEOS_STORYBOARD_SEGMENT = "storyboard";

/** Top-level folder for Product Photo (uploads + generated images) */
export const PHOTOS_FOLDER = "photos";

export function isStorageRelativePath(value: string): boolean {
  return value.startsWith(`${PHOTOS_FOLDER}/`) || value.startsWith(`${VIDEOS_FOLDER}/`);
}

/** @deprecated Scheduler device uploads only — generations use `videosUserPrefix`. */
export function videosStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${filename}`;
}

/** @deprecated Legacy global temp — new generations use `videosUserTempPath`. */
export function videosTempStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${filename}`;
}

/** Path segment that marks transient reference uploads (legacy or per-user). */
const TEMP_REFS_SEGMENT_PATH = `/${VIDEOS_TEMP_SEGMENT}/${VIDEOS_TEMP_REFS_SEGMENT}/`;

/** @deprecated Legacy global refs prefix — use `videosUserTempRefPath`. */
export const VIDEOS_TEMP_REFS_PREFIX = `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${VIDEOS_TEMP_REFS_SEGMENT}/`;

/** Storage prefix per authenticated user: `videos/{userId}/` (mirrors `photos/{userId}/`). */
export function videosUserPrefix(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("Invalid user id");
  return `${VIDEOS_FOLDER}/${safe}`;
}

/** Video studio modes under `generated/video/` (sibling folders, one per tool). */
export type VideoStudioMode = "reelscreator" | "t2v" | "i2v" | "motion-control";

function safeModeSegment(mode: string, label: string): string {
  const safe = mode.replace(/[^a-z0-9-]/g, "");
  if (!safe) throw new Error(`Invalid ${label}: "${mode}"`);
  return safe;
}

/** `videos/{userId}/generated/video/{mode}/{filename}` */
export function videosGeneratedVideoPath(
  userId: string,
  mode: VideoStudioMode,
  filename: string,
): string {
  return `${videosUserPrefix(userId)}/generated/video/${safeModeSegment(mode, "video mode")}/${filename}`;
}

/** Storyboard tab i2v output: `videos/{userId}/generated/storyboard/{filename}` */
export function videosStoryboardVideoPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/generated/storyboard/${filename}`;
}

/** @deprecated Use `videosGeneratedVideoPath` with the correct mode. */
export function videosGeneratedPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/generated/${filename}`;
}

/** Scheduler device uploads: `videos/{userId}/uploads/scheduler/<filename>`. */
export function videosSchedulerUploadPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/uploads/scheduler/${filename}`;
}

/** Transient per-user files (captions, scratch): `videos/{userId}/temp/<filename>`. */
export function videosUserTempPath(userId: string, filename: string): string {
  return `${videosUserPrefix(userId)}/${VIDEOS_TEMP_SEGMENT}/${filename}`;
}

/**
 * Transient generation reference uploads under `videos/{userId}/temp/refs/<filename>`.
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
  return (
    typeof path === "string" &&
    path.startsWith(`${VIDEOS_FOLDER}/`) &&
    path.includes(TEMP_REFS_SEGMENT_PATH)
  );
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
  if (!path.startsWith(`${VIDEOS_FOLDER}/`)) return false;
  const rest = path.slice(VIDEOS_FOLDER.length + 1);
  return (
    rest.startsWith(`${VIDEOS_TEMP_SEGMENT}/`) ||
    rest.includes(`/${VIDEOS_TEMP_SEGMENT}/`)
  );
}

/** Postgres table for Storyboard metadata (public URLs only — never Replicate prediction URLs). */
export const STORYBOARDS_TABLE = "storyboards";

/** Postgres table for all tool outputs (one row per successful create, per user). */
export const USER_CREATIONS_TABLE = "user_creations";

/** @deprecated Use USER_CREATIONS_TABLE with tool=product_photo */
export const PRODUCT_PHOTO_GENERATIONS_TABLE = "product_photo_generations";

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

/** Public or signed Supabase Storage URL → `photos/...` or `videos/...` path. */
export function storagePathFromStorageUrl(url: string | null | undefined): string | null {
  return storagePathFromPublicUrl(url) ?? storagePathFromSignedUrl(url);
}

// NOTE: this module is imported by client components too (e.g. lib/product-photo.ts,
// transitively reachable from the dashboard). Keep it free of `lib/supabase-server`
// (or any other server-secret-touching import) — the Storage API-calling
// existence check lives in `lib/video-storage.ts` instead.
