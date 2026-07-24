/**
 * Signed read URLs for private Supabase Storage objects.
 * Server-only — uses service role via supabaseServer.
 */
import { supabaseServer } from "@/lib/supabase-server";
import {
  STORAGE_BUCKET,
  isStorageRelativePath,
  storagePathFromPublicUrl,
  storagePathFromSignedUrl,
  storagePathOwnerUserId,
} from "@/lib/storage-buckets";
import { getAssetForProfile } from "@/lib/assets-db";
import { getSessionUserId } from "@/lib/resolve-user";

export const SIGN_TTL = {
  ui: 3600,
  pipeline: 21600,
  publish: 900,
} as const;

export type SignTtlKind = keyof typeof SIGN_TTL;

export type SignedStorageUrl = {
  url: string;
  expiresAt: string;
  storagePath: string;
};

function ttlSec(kind: SignTtlKind | number): number {
  return typeof kind === "number" ? kind : SIGN_TTL[kind];
}

export { isStorageRelativePath, storagePathOwnerUserId };

function isAllowedStoragePath(path: string): boolean {
  return isStorageRelativePath(path) && !path.includes("..");
}

/** Resolve a DB field that may hold a path or legacy public URL. */
export function resolveStoragePath(
  storagePath?: string | null,
  urlOrPath?: string | null,
): string | null {
  if (storagePath?.trim()) return storagePath.trim();
  if (!urlOrPath?.trim()) return null;
  const raw = urlOrPath.trim();
  if (isStorageRelativePath(raw)) return raw;
  return storagePathFromPublicUrl(raw) ?? storagePathFromSignedUrl(raw);
}

async function pathReferencedByUser(path: string, userId: string): Promise<boolean> {
  const { data: creation } = await supabaseServer
    .from("user_creations")
    .select("id")
    .eq("user_id", userId)
    .or(`storage_path.eq.${path},media_url.eq.${path},media_url.ilike.%${path}%`)
    .limit(1)
    .maybeSingle();
  if (creation) return true;

  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profile?.id) {
    const { data: asset } = await supabaseServer
      .from("assets")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("storage_path", path)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (asset) return true;
  }

  const { data: storyboard } = await supabaseServer
    .from("storyboards")
    .select("id")
    .eq("user_id", userId)
    .or(`storyboard_url.ilike.%${path}%,video_url.ilike.%${path}%`)
    .limit(1)
    .maybeSingle();
  return Boolean(storyboard);
}

/** Throws if the path is outside photos/ or videos/ or not owned by userId. */
export async function assertPathOwnedByUser(path: string, userId: string): Promise<void> {
  if (!isAllowedStoragePath(path)) {
    throw new Error("Invalid storage path.");
  }
  const owner = storagePathOwnerUserId(path);
  if (owner === userId) return;
  if (await pathReferencedByUser(path, userId)) return;
  throw new Error("Forbidden");
}

export async function createSignedStorageUrl(
  storagePath: string,
  ttl: SignTtlKind | number = "ui",
): Promise<SignedStorageUrl> {
  if (!isAllowedStoragePath(storagePath)) {
    throw new Error("Invalid storage path.");
  }
  const expiresIn = ttlSec(ttl);
  const { data, error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL.");
  }
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    storagePath,
  };
}

export async function signStoragePathForUser(
  storagePath: string,
  userId: string,
  ttl: SignTtlKind | number = "ui",
): Promise<SignedStorageUrl> {
  await assertPathOwnedByUser(storagePath, userId);
  return createSignedStorageUrl(storagePath, ttl);
}

export async function signAssetForUser(
  assetId: string,
  userId: string,
  ttl: SignTtlKind | number = "ui",
): Promise<SignedStorageUrl> {
  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.id) throw new Error("Asset not found.");

  const asset = await getAssetForProfile(profile.id, assetId);
  if (!asset?.storage_path) throw new Error("Asset not found.");
  return signStoragePathForUser(asset.storage_path, userId, ttl);
}

/** Sign for pipeline consumers (Rendi/Replicate) — caller supplies userId. */
export async function signStoragePathForPipeline(
  storagePath: string,
  userId: string,
): Promise<string> {
  const signed = await signStoragePathForUser(storagePath, userId, "pipeline");
  return signed.url;
}

/** Resolve a client ref attachment to a fetchable URL for Replicate/Rendi (pipeline TTL). */
export async function resolveRefForPipeline(
  userId: string,
  ref: { url?: string | null; path?: string | null },
): Promise<string | null> {
  const path = resolveStoragePath(ref.path, ref.url);
  if (path) {
    return signStoragePathForPipeline(path, userId);
  }
  const raw = ref.url?.trim();
  if (raw?.startsWith("http")) return raw;
  return null;
}

/** Prefer storage_path; fall back to legacy public URL; external URLs pass through. */
export async function resolveSignedMediaUrl(params: {
  userId: string;
  storagePath?: string | null;
  mediaUrl?: string | null;
  ttl?: SignTtlKind | number;
}): Promise<string | null> {
  const path = resolveStoragePath(params.storagePath, params.mediaUrl);
  if (path) {
    const signed = await signStoragePathForUser(path, params.userId, params.ttl ?? "ui");
    return signed.url;
  }
  const raw = params.mediaUrl?.trim();
  if (raw?.startsWith("http")) return raw;
  return null;
}

export async function requireSessionUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error("Not authenticated.");
  return userId;
}

/** Cron / server publish: sign without session (path must already be validated). */
export async function signStoragePathForPublish(storagePath: string): Promise<string> {
  const signed = await createSignedStorageUrl(storagePath, "publish");
  return signed.url;
}

/** Resolve a fetchable publish URL from a post row (path, legacy URL, or asset). */
export async function resolvePublishVideoUrl(params: {
  videoUrl?: string | null;
  assetStoragePath?: string | null;
}): Promise<string> {
  const path = resolveStoragePath(params.assetStoragePath, params.videoUrl);
  if (path) return signStoragePathForPublish(path);
  const raw = params.videoUrl?.trim();
  if (raw?.startsWith("http")) return raw;
  throw new Error("No publishable video location for this post.");
}
