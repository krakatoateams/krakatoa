import { supabaseServer } from "@/lib/supabase-server";
import {
  STORAGE_BUCKET,
  userResumablePath,
  userResumablePrefix,
  safeUserIdSegment,
  RESUMABLE_SEGMENT,
} from "@/lib/storage-buckets";

interface ListEntry {
  name: string;
  id: string | null;
}

/** Recursively list object paths under a prefix. */
async function listObjectPaths(prefix: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(p: string): Promise<void> {
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const { data, error } = await supabaseServer.storage
        .from(STORAGE_BUCKET)
        .list(p, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`storage.list failed at "${p}": ${error.message}`);
      const entries = (data ?? []) as ListEntry[];
      for (const e of entries) {
        const full = p ? `${p}/${e.name}` : e.name;
        if (e.id === null) {
          await walk(full);
        } else {
          out.push(full);
        }
      }
      if (entries.length < limit) break;
      offset += limit;
    }
  }

  await walk(prefix);
  return out;
}

/** Fetch a remote URL and upload into the user's resumable job folder. */
export async function copyUrlToResumable(
  userId: string,
  jobId: string,
  relativePath: string,
  sourceUrl: string,
  contentType: string,
): Promise<string> {
  const resp = await fetch(sourceUrl);
  if (!resp.ok) {
    throw new Error(`Failed to fetch source for resumable copy: ${resp.status} ${resp.statusText}`);
  }
  const buffer = await resp.arrayBuffer();
  const storagePath = userResumablePath(userId, jobId, relativePath);
  const { error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      // Not MEDIA_CACHE_CONTROL: resumable paths are upserted on retry, and only
      // Rendi/Replicate ever fetch them, so there is no browser cache to win.
      cacheControl: "3600",
      upsert: true,
    });
  if (error) {
    throw new Error(`Failed to upload resumable artifact: ${error.message}`);
  }
  return storagePath;
}

/** Upload text/binary content to resumable storage. */
export async function uploadToResumable(
  userId: string,
  jobId: string,
  relativePath: string,
  body: string | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const storagePath = userResumablePath(userId, jobId, relativePath);
  const { error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, body, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });
  if (error) {
    throw new Error(`Failed to upload resumable file: ${error.message}`);
  }
  return storagePath;
}

/** Best-effort delete of all objects under `{userId}/resumable/{jobId}/`. */
export async function purgeResumableJobStorage(userId: string, jobId: string): Promise<number> {
  const prefix = userResumablePrefix(userId, jobId);
  try {
    const paths = await listObjectPaths(prefix);
    if (paths.length === 0) return 0;
    const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) {
      console.warn("[pipeline-recovery] purge remove failed:", error.message);
      return 0;
    }
    return paths.length;
  } catch (e) {
    console.warn("[pipeline-recovery] purge failed (non-fatal):", e);
    return 0;
  }
}

/** List top-level resumable job folders for a user: `{userId}/resumable/{jobId}`. */
export async function listUserResumableJobIds(userId: string): Promise<string[]> {
  const resumableRoot = `${safeUserIdSegment(userId)}/${RESUMABLE_SEGMENT}`;
  const { data, error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .list(resumableRoot, { limit: 1000 });
  if (error) {
    console.warn("[pipeline-recovery] list resumable root failed:", error.message);
    return [];
  }
  return (data ?? [])
    .filter((e) => e.id === null)
    .map((e) => e.name)
    .filter(Boolean);
}
