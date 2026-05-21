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
 * ---------------------------------------------------------------------------
 */
export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

/** Top-level folder for ReelsGen (.ass, .mp4) */
export const VIDEOS_FOLDER = "videos";

/** Ephemeral ReelsGen assets (e.g. .ass passed to Rendi, then deleted) */
export const VIDEOS_TEMP_SEGMENT = "temp";

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

/** Storyboard tab assets: `videos/storyboard/<filename>` */
export function videosStoryboardPath(filename: string): string {
  return `${VIDEOS_FOLDER}/${VIDEOS_STORYBOARD_SEGMENT}/${filename}`;
}

/** Postgres table for Storyboard metadata (public URLs only — never Replicate prediction URLs). */
export const STORYBOARDS_TABLE = "storyboards";

export function photosStoragePath(...segments: string[]): string {
  return [PHOTOS_FOLDER, ...segments].join("/");
}
