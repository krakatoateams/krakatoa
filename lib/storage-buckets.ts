/**
 * Krakatoa uses one public Supabase Storage bucket with top-level folders per feature.
 * Product photos live under `photos/` — never inside `videos/`.
 *
 * Create the bucket in Supabase Dashboard → Storage, then add public folders as needed.
 * Override the bucket name with SUPABASE_STORAGE_BUCKET in .env.local if needed.
 */
export const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

/** Top-level folder for ReelsGen (.ass, .mp4) */
export const VIDEOS_FOLDER = "videos";

/** Top-level folder for Product Photo (uploads + generated images) */
export const PHOTOS_FOLDER = "photos";

export function videosStoragePath(filename: string): string {
  return `${VIDEOS_FOLDER}/${filename}`;
}

export function photosStoragePath(...segments: string[]): string {
  return [PHOTOS_FOLDER, ...segments].join("/");
}
