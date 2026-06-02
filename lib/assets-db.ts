import { supabaseServer } from "@/lib/supabase-server";

export type AssetType =
  | "image"
  | "video"
  | "audio"
  | "subtitle"
  | "json"
  | "storyboard"
  | "document"
  | "other";

export type AssetStatus = "processing" | "ready" | "failed" | "deleted";

export type AssetVisibility = "private" | "unlisted" | "public";

export type Asset = {
  id: string;
  profile_id: string;
  project_id: string | null;
  job_id: string | null;
  tool: string;
  asset_type: AssetType;
  role: string;
  status: AssetStatus;
  bucket: string;
  storage_path: string | null;
  public_url: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  provider: string | null;
  model: string | null;
  cost_credits: number;
  visibility: AssetVisibility;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const ASSETS_TABLE = "assets";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("assets") && error.message.includes("schema cache")) {
    throw new Error(
      "Database table assets is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/**
 * Create an asset in 'processing' state. storage_path / public_url stay null
 * until the file is uploaded and `markAssetReady` is called — never use an
 * empty-string URL for an in-progress asset.
 */
export async function createProcessingAsset(params: {
  profileId: string;
  tool: string;
  assetType: AssetType;
  role: string;
  projectId?: string | null;
  jobId?: string | null;
  bucket?: string;
  provider?: string;
  model?: string;
  visibility?: AssetVisibility;
  metadata?: Record<string, unknown>;
}): Promise<Asset> {
  const { data, error } = await supabaseServer
    .from(ASSETS_TABLE)
    .insert({
      profile_id: params.profileId,
      project_id: params.projectId ?? null,
      job_id: params.jobId ?? null,
      tool: params.tool,
      asset_type: params.assetType,
      role: params.role,
      status: "processing",
      bucket: params.bucket ?? "krakatoa",
      provider: params.provider ?? null,
      model: params.model ?? null,
      visibility: params.visibility ?? "private",
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  handleError(error, "Failed to create asset.");
  return data as Asset;
}

/** Mark an asset 'ready' with its storage location + media details. */
export async function markAssetReady(
  profileId: string,
  assetId: string,
  params: {
    storagePath?: string;
    publicUrl?: string;
    mimeType?: string;
    fileSizeBytes?: number;
    width?: number;
    height?: number;
    durationSec?: number;
    costCredits?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<Asset | null> {
  const patch: Record<string, unknown> = { status: "ready" };
  if (params.storagePath !== undefined) patch.storage_path = params.storagePath;
  if (params.publicUrl !== undefined) patch.public_url = params.publicUrl;
  if (params.mimeType !== undefined) patch.mime_type = params.mimeType;
  if (params.fileSizeBytes !== undefined) patch.file_size_bytes = params.fileSizeBytes;
  if (params.width !== undefined) patch.width = params.width;
  if (params.height !== undefined) patch.height = params.height;
  if (params.durationSec !== undefined) patch.duration_sec = params.durationSec;
  if (params.costCredits !== undefined) patch.cost_credits = params.costCredits;
  if (params.metadata !== undefined) patch.metadata = params.metadata;

  const { data, error } = await supabaseServer
    .from(ASSETS_TABLE)
    .update(patch)
    .eq("id", assetId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to mark asset ready.");
  return (data as Asset | null) ?? null;
}

/** Mark an asset 'failed', recording a structured error in metadata. */
export async function markAssetFailed(
  profileId: string,
  assetId: string,
  error?: Record<string, unknown> | string
): Promise<Asset | null> {
  const patch: Record<string, unknown> = { status: "failed" };
  if (error !== undefined) {
    patch.metadata = {
      error: typeof error === "string" ? { message: error } : error,
    };
  }

  const { data, error: dbError } = await supabaseServer
    .from(ASSETS_TABLE)
    .update(patch)
    .eq("id", assetId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(dbError, "Failed to mark asset failed.");
  return (data as Asset | null) ?? null;
}

/** Soft-delete an asset (storage files are NOT removed here). */
export async function softDeleteAsset(
  profileId: string,
  assetId: string
): Promise<Asset | null> {
  const { data, error } = await supabaseServer
    .from(ASSETS_TABLE)
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to delete asset.");
  return (data as Asset | null) ?? null;
}

/** Update an asset's visibility (ownership-checked). */
export async function setAssetVisibility(
  profileId: string,
  assetId: string,
  visibility: AssetVisibility
): Promise<Asset | null> {
  const { data, error } = await supabaseServer
    .from(ASSETS_TABLE)
    .update({ visibility })
    .eq("id", assetId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to set asset visibility.");
  return (data as Asset | null) ?? null;
}

/**
 * List a profile's assets. Defaults to ready + non-deleted (gallery/picker
 * semantics). Pass `status` / `includeDeleted` to broaden.
 */
export async function listAssets(
  profileId: string,
  options?: {
    tool?: string;
    assetType?: AssetType;
    role?: string;
    status?: AssetStatus;
    projectId?: string;
    jobId?: string;
    includeDeleted?: boolean;
    limit?: number;
  }
): Promise<Asset[]> {
  let query = supabaseServer
    .from(ASSETS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  // Default gallery view: only ready assets.
  query = query.eq("status", options?.status ?? "ready");

  if (!options?.includeDeleted) {
    query = query.is("deleted_at", null);
  }
  if (options?.tool) query = query.eq("tool", options.tool);
  if (options?.assetType) query = query.eq("asset_type", options.assetType);
  if (options?.role) query = query.eq("role", options.role);
  if (options?.projectId) query = query.eq("project_id", options.projectId);
  if (options?.jobId) query = query.eq("job_id", options.jobId);

  const { data, error } = await query;
  handleError(error, "Failed to list assets.");
  return (data as Asset[] | null) ?? [];
}

/** Fetch a single asset, scoped to the owning profile. Returns null if not found. */
export async function getAssetForProfile(
  profileId: string,
  assetId: string
): Promise<Asset | null> {
  const { data, error } = await supabaseServer
    .from(ASSETS_TABLE)
    .select("*")
    .eq("id", assetId)
    .eq("profile_id", profileId)
    .maybeSingle();

  handleError(error, "Failed to fetch asset.");
  return (data as Asset | null) ?? null;
}
