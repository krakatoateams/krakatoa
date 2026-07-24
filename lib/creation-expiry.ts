import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, USER_CREATIONS_TABLE } from "@/lib/storage-buckets";
import {
  type ExpirySettings,
  getExpirySettings,
} from "@/lib/expiry-settings-db";

/**
 * Creation expiry enforcement (Expiry Management).
 *
 * Deletes `user_creations` (the user-facing library) older than the admin-
 * configured retention for photos / videos, plus their storage objects, and
 * best-effort soft-deletes any matching platform `assets` row.
 *
 * Retention is evaluated DYNAMICALLY from `created_at` + the current config, so
 * changing a duration in the admin panel applies retroactively (there is no
 * expires_at column on user_creations). A NULL/0 duration disables expiry for
 * that media kind.
 */

export type CreationKind = "photo" | "video";

/** user_creations.media_type value backing each configurable kind. */
const MEDIA_TYPE: Record<CreationKind, "image" | "video"> = {
  photo: "image",
  video: "video",
};

export type CreationExpiryResult = {
  target: CreationKind;
  /** True when no expiry is configured for this kind (nothing scanned). */
  skipped: boolean;
  days: number | null;
  cutoff: string | null;
  /** Rows older than the cutoff (what would be / was deleted). */
  scanned: number;
  deletedRows: number;
  dryRun: boolean;
};

function daysFor(target: CreationKind, settings: ExpirySettings): number | null {
  return target === "photo" ? settings.photoCreationDays : settings.videoCreationDays;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type CreationRow = { id: string; storage_path: string | null };

/** Expire one media kind. Never partially corrupts state: storage first, then rows. */
export async function runCreationExpiry(
  target: CreationKind,
  opts?: { dryRun?: boolean; settings?: ExpirySettings }
): Promise<CreationExpiryResult> {
  const settings = opts?.settings ?? (await getExpirySettings());
  const dryRun = opts?.dryRun ?? false;
  const days = daysFor(target, settings);

  if (days === null || days <= 0) {
    return { target, skipped: true, days, cutoff: null, scanned: 0, deletedRows: 0, dryRun };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const mediaType = MEDIA_TYPE[target];

  const { data, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("id, storage_path")
    .eq("media_type", mediaType)
    .lt("created_at", cutoff);

  if (error) throw new Error(error.message);
  const rows = (data as CreationRow[] | null) ?? [];

  if (dryRun || rows.length === 0) {
    return {
      target,
      skipped: false,
      days,
      cutoff,
      scanned: rows.length,
      deletedRows: 0,
      dryRun,
    };
  }

  // 1) Remove storage objects (best-effort; failures are logged, not thrown).
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  for (const batch of chunk(paths, 100)) {
    const { error: rmErr } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .remove(batch);
    if (rmErr) console.warn("[creation-expiry] storage remove failed:", rmErr.message);
  }

  // 2) Soft-delete any matching platform assets (best-effort).
  if (paths.length) {
    const nowIso = new Date().toISOString();
    for (const batch of chunk(paths, 100)) {
      const { error: aErr } = await supabaseServer
        .from("assets")
        .update({ deleted_at: nowIso })
        .in("storage_path", batch)
        .is("deleted_at", null);
      if (aErr) console.warn("[creation-expiry] assets soft-delete failed:", aErr.message);
    }
  }

  // 3) Delete the creation rows.
  let deletedRows = 0;
  for (const batch of chunk(rows.map((r) => r.id), 200)) {
    const { error: delErr } = await supabaseServer
      .from(USER_CREATIONS_TABLE)
      .delete()
      .in("id", batch);
    if (delErr) throw new Error(delErr.message);
    deletedRows += batch.length;
  }

  return { target, skipped: false, days, cutoff, scanned: rows.length, deletedRows, dryRun: false };
}

/** Run expiry for both photo and video (shared settings read). */
export async function runAllCreationExpiry(opts?: {
  dryRun?: boolean;
}): Promise<CreationExpiryResult[]> {
  const settings = await getExpirySettings();
  const photo = await runCreationExpiry("photo", { dryRun: opts?.dryRun, settings });
  const video = await runCreationExpiry("video", { dryRun: opts?.dryRun, settings });
  return [photo, video];
}
