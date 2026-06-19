/**
 * Krakatoa uses one public Supabase Storage bucket with top-level folders per feature.
 * Product photos live under `photos/` — never inside `videos/`.
 * ReelsGen: final MP4s under `videos/`; transient caption files under `videos/temp/`; Storyboard tab under `videos/storyboard/`.
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

/** Final ReelsGen outputs (e.g. `reels_*.mp4`) — public download URLs. */
export function videosStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${filename}`;
}

/** Transient ReelsGen files under `videos/temp/` (captions, scratch uploads). */
export function videosTempStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${filename}`;
}

/** Prefix for transient generation reference uploads (`videos/temp/refs/`). */
export const VIDEOS_TEMP_REFS_PREFIX = `${VIDEOS_FOLDER}/${VIDEOS_TEMP_SEGMENT}/${VIDEOS_TEMP_REFS_SEGMENT}/`;

/**
 * Transient generation reference uploads under `videos/temp/refs/<filename>`.
 * Covered by the `videos/temp/` storage sweep, and explicitly removed by the
 * generation route's `finally` cleanup after success/failure/insufficient-credits.
 */
export function videosTempRefPath(filename: string): string {
  return `${VIDEOS_TEMP_REFS_PREFIX}${filename}`;
}

/** Whether a storage path lives under the transient reference-uploads prefix. */
export function isVideosTempRefPath(path: string): boolean {
  return typeof path === "string" && path.startsWith(VIDEOS_TEMP_REFS_PREFIX);
}

/** Storyboard tab assets: `videos/storyboard/<filename>` */
export function videosStoryboardPath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_STORYBOARD_SEGMENT}/${filename}`;
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
