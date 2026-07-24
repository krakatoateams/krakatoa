import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, VIDEOS_FOLDER, isVideosTempPath } from "@/lib/storage-buckets";
import {
  collectStorageReferences,
  isReferenced,
  listAllObjects,
} from "@/lib/storage-orphan-audit";

/**
 * Storage hygiene sweep (see openspec/changes/storage-hygiene).
 *
 * Removes transient + orphaned objects from the `videos/` folder so the bucket
 * self-heals instead of growing forever. An object is deletable when it is:
 *   - under `videos/temp/` (transient by design), OR
 *   - "orphan" (no `assets`/`posts`/`user_creations`/`storyboards` row references it)
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

export { isReferenced };

/**
 * Build the deletion plan without deleting anything.
 * `deletable` = temp files OR (unreferenced AND older than `minAgeHours`).
 */
export async function planStorageSweep(
  minAgeHours: number = DEFAULT_SWEEP_MIN_AGE_HOURS,
): Promise<SweepPlan> {
  const [objects, refBlob] = await Promise.all([
    listAllObjects(VIDEOS_FOLDER),
    collectStorageReferences(),
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
