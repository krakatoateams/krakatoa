/**
 * Krakatoa uses one public Supabase Storage bucket with top-level folders per feature.
 * Product photos live under `photos/` — never inside `videos/`.
 * ReelsGen: final MP4s under `videos/`; transient caption files under `videos/temp/`.
 *
 * Create the bucket in Supabase Dashboard → Storage, then add public folders as needed.
 * Override the bucket name with SUPABASE_STORAGE_BUCKET in .env.local if needed.
 */
export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

/** Top-level folder for ReelsGen (.ass, .mp4) */
export const VIDEOS_FOLDER = "videos";

/** Ephemeral ReelsGen assets (e.g. .ass passed to Rendi, then deleted) */
export const VIDEOS_TEMP_SEGMENT = "temp";

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

export function photosStoragePath(...segments: string[]): string {
  return [PHOTOS_FOLDER, ...segments].join("/");
}
