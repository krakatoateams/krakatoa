import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, VIDEOS_FOLDER, isVideosTempPath } from "@/lib/storage-buckets";

/**
 * Storage hygiene sweep (see openspec/changes/storage-hygiene).
 *
 * Removes transient + orphaned objects from the `videos/` folder so the bucket
 * self-heals instead of growing forever. An object is deletable when it is:
 *   - under `videos/temp/` (transient by design), OR
 *   - "orphan" (no `posts`/`user_creations`/`storyboards` row references it)
 *     AND older than a safety age threshold (default 24h).
 *
 * The age guard is what makes immediate-upload safe: a freshly uploaded file
 * that the user is still captioning/scheduling in the same session is never
 * swept, because it is younger than the threshold.
 *
 * Reference matching is deliberately conservative — when in doubt, keep.
 */

export const DEFAULT_SWEEP_MIN_AGE_HOURS = 24;

export interface SweepObject {
  path: string;
  size: number;
  /** ms epoch of the object's storage created_at (falls back to updated_at), or null. */
  createdAtMs: number | null;
}

export interface SweepPlan {
  keep: SweepObject[];
  deletable: Array<SweepObject & { reason: "temp" | "orphan" }>;
  totals: {
    scanned: number;
    keepBytes: number;
    deletableBytes: number;
  };
}

export interface SweepResult extends SweepPlan {
  dryRun: boolean;
  minAgeHours: number;
  deletedCount: number;
  reclaimedBytes: number;
}

interface StorageListEntry {
  name: string;
  id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number } | null;
}

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Recursively list every object under a prefix (folders have id === null). */
async function listAllObjects(prefix: string): Promise<SweepObject[]> {
  const out: SweepObject[] = [];

  async function walk(p: string): Promise<void> {
    let offset = 0;
    const limit = 1000;
    // Page through this folder.
    for (;;) {
      const { data, error } = await supabaseServer.storage
        .from(STORAGE_BUCKET)
        .list(p, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`storage.list failed at "${p}": ${error.message}`);
      const entries = (data ?? []) as StorageListEntry[];
      for (const e of entries) {
        const full = p ? `${p}/${e.name}` : e.name;
        if (e.id === null) {
          await walk(full); // folder
        } else {
          out.push({
            path: full,
            size: e.metadata?.size ?? 0,
            createdAtMs: toMs(e.created_at) ?? toMs(e.updated_at),
          });
        }
      }
      if (entries.length < limit) break;
      offset += limit;
    }
  }

  await walk(prefix);
  return out;
}

/** Collect every string in the DB that could reference a stored video. */
async function collectReferenceBlob(): Promise<string> {
  const refs: string[] = [];

  async function pull(table: string, columns: string[]): Promise<void> {
    const { data, error } = await supabaseServer.from(table).select(columns.join(","));
    if (error) {
      // A missing/renamed table must not abort the sweep — just skip it.
      console.warn(`[storage-sweep] skip table ${table}: ${error.message}`);
      return;
    }
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      for (const col of columns) {
        const v = row[col];
        if (typeof v === "string" && v) {
          refs.push(v);
          try {
            const decoded = decodeURIComponent(v);
            if (decoded !== v) refs.push(decoded);
          } catch {
            // malformed escape sequence — ignore
          }
        }
      }
    }
  }

  await pull("user_creations", ["media_url", "storage_path"]);
  await pull("posts", ["video_url"]);
  await pull("storyboards", ["video_url", "storyboard_url"]);

  return refs.join("\n");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Conservative reference test: an object is "referenced" when its full path OR
 * its basename appears anywhere in the reference blob. Over-inclusive on
 * purpose — we would rather keep an orphan than delete something in use.
 */
export function isReferenced(path: string, refBlob: string): boolean {
  if (refBlob.includes(path)) return true;
  const bn = basename(path);
  return bn.length > 0 && refBlob.includes(bn);
}

/**
 * Build the deletion plan without deleting anything.
 * `deletable` = temp files OR (unreferenced AND older than `minAgeHours`).
 */
export async function planStorageSweep(
  minAgeHours: number = DEFAULT_SWEEP_MIN_AGE_HOURS,
): Promise<SweepPlan> {
  const [objects, refBlob] = await Promise.all([
    listAllObjects(VIDEOS_FOLDER),
    collectReferenceBlob(),
  ]);

  const cutoffMs = Date.now() - minAgeHours * 60 * 60 * 1000;

  const keep: SweepObject[] = [];
  const deletable: Array<SweepObject & { reason: "temp" | "orphan" }> = [];

  for (const obj of objects) {
    const isTemp = isVideosTempPath(obj.path);
    // Without a timestamp we cannot prove the object is old enough → keep it.
    const isOldEnough = obj.createdAtMs !== null && obj.createdAtMs < cutoffMs;

    if (isTemp) {
      if (isOldEnough) {
        deletable.push({ ...obj, reason: "temp" });
      } else {
        keep.push(obj);
      }
      continue;
    }

    if (!isReferenced(obj.path, refBlob) && isOldEnough) {
      deletable.push({ ...obj, reason: "orphan" });
    } else {
      keep.push(obj);
    }
  }

  const sum = (arr: SweepObject[]) => arr.reduce((a, o) => a + o.size, 0);
  return {
    keep,
    deletable,
    totals: {
      scanned: objects.length,
      keepBytes: sum(keep),
      deletableBytes: sum(deletable),
    },
  };
}

/** Plan, then (unless dryRun) delete in batches of 100. */
export async function runStorageSweep(opts?: {
  dryRun?: boolean;
  minAgeHours?: number;
}): Promise<SweepResult> {
  const dryRun = opts?.dryRun ?? false;
  const minAgeHours = opts?.minAgeHours ?? DEFAULT_SWEEP_MIN_AGE_HOURS;

  const plan = await planStorageSweep(minAgeHours);
  const paths = plan.deletable.map((o) => o.path);

  let deletedCount = 0;
  if (!dryRun && paths.length > 0) {
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove(batch);
      if (error) throw new Error(`storage.remove failed: ${error.message}`);
      deletedCount += batch.length;
    }
  }

  return {
    ...plan,
    dryRun,
    minAgeHours,
    deletedCount,
    reclaimedBytes: dryRun ? 0 : plan.totals.deletableBytes,
  };
}
