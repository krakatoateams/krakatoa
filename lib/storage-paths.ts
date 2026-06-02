/**
 * UUID-based Supabase Storage path conventions for the platform foundation.
 *
 * Rules:
 *   - Paths use profile_id / project_id / job_id / asset_id ONLY.
 *   - Never embed email, username, or display name in a storage path.
 *   - `assets.storage_path` (in the DB) is the source of truth; these helpers
 *     just generate canonical paths to store there.
 *
 * Legacy paths under `videos/` and `photos/` are unaffected — those continue to
 * be produced by the existing tools until they migrate to assets.
 */

export const PLATFORM_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";

const PROFILES_SEGMENT = "profiles";
const PROJECTS_SEGMENT = "projects";
const JOBS_SEGMENT = "jobs";
const ASSETS_SEGMENT = "assets";

function requireId(label: string, value: string): string {
  const safe = String(value || "").trim();
  if (!safe || /[^a-zA-Z0-9-]/.test(safe)) {
    throw new Error(`Invalid ${label} for storage path: "${value}"`);
  }
  return safe;
}

function stripExtDot(ext: string): string {
  return ext.replace(/^\.+/, "").toLowerCase();
}

/** `profiles/{profileId}` */
export function profilePrefix(profileId: string): string {
  return `${PROFILES_SEGMENT}/${requireId("profileId", profileId)}`;
}

/**
 * Job-scoped prefix. When `projectId` is null, jobs are nested directly under
 * the profile (`profiles/{profileId}/jobs/{jobId}`); otherwise under the
 * project (`profiles/{profileId}/projects/{projectId}/jobs/{jobId}`).
 */
export function jobPrefix(
  profileId: string,
  projectId: string | null,
  jobId: string
): string {
  const base = profilePrefix(profileId);
  const jid = requireId("jobId", jobId);
  if (projectId) {
    return `${base}/${PROJECTS_SEGMENT}/${requireId("projectId", projectId)}/${JOBS_SEGMENT}/${jid}`;
  }
  return `${base}/${JOBS_SEGMENT}/${jid}`;
}

/** `.../jobs/{jobId}/outputs/{filename}` */
export function jobOutputPath(
  profileId: string,
  projectId: string | null,
  jobId: string,
  filename: string
): string {
  return `${jobPrefix(profileId, projectId, jobId)}/outputs/${filename}`;
}

/** `.../jobs/{jobId}/temp/{filename}` (transient files; safe to clean up). */
export function jobTempPath(
  profileId: string,
  projectId: string | null,
  jobId: string,
  filename: string
): string {
  return `${jobPrefix(profileId, projectId, jobId)}/temp/${filename}`;
}

/** `profiles/{profileId}/assets/{assetId}/original.{ext}` */
export function assetOriginalPath(
  profileId: string,
  assetId: string,
  ext: string
): string {
  return `${profilePrefix(profileId)}/${ASSETS_SEGMENT}/${requireId("assetId", assetId)}/original.${stripExtDot(ext)}`;
}

/** `profiles/{profileId}/assets/{assetId}/thumbnail.{ext}` (defaults to jpg). */
export function assetThumbnailPath(
  profileId: string,
  assetId: string,
  ext = "jpg"
): string {
  return `${profilePrefix(profileId)}/${ASSETS_SEGMENT}/${requireId("assetId", assetId)}/thumbnail.${stripExtDot(ext)}`;
}
