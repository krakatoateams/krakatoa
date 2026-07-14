import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, storagePathFromPublicUrl } from "@/lib/storage-buckets";

// Server-only (imports lib/supabase-server, which needs SUPABASE_SERVICE_ROLE_KEY).
// Never import this from a client component or from lib/storage-buckets.ts itself.

/**
 * Ask the Storage API (not the CDN-fronted public URL) whether an object
 * exists at `path`. Queried via `list()` so a stale CDN cache can't produce a
 * false positive/negative — same technique `lib/storage-sweep.ts` uses.
 * Returns null (undeterminable) on any Storage API error.
 */
export async function videoObjectExists(path: string): Promise<boolean | null> {
  const slashIdx = path.lastIndexOf("/");
  const dir = slashIdx === -1 ? "" : path.slice(0, slashIdx);
  const name = slashIdx === -1 ? path : path.slice(slashIdx + 1);
  try {
    const { data, error } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .list(dir, { search: name, limit: 1 });
    if (error) return null;
    return (data ?? []).some((entry) => entry.name === name);
  } catch {
    return null;
  }
}

/**
 * Fail-open combinator over the two helpers above: true unless the object is
 * confirmed absent. A URL outside this bucket, or a Storage API error, is
 * treated as "not confirmed missing" so callers never block on ambiguity.
 */
export async function isVideoUrlConfirmedMissing(url: string | null | undefined): Promise<boolean> {
  const path = storagePathFromPublicUrl(url);
  if (!path) return false;
  const exists = await videoObjectExists(path);
  return exists === false;
}
