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
  asOf: string;
  cutoff: string | null;
  /** Rows older than the cutoff (what would be / was deleted). */
  scanned: number;
  deletedRows: number;
  dryRun: boolean;
  /** True when bounded processing left more eligible rows for a later run. */
  partial: boolean;
  remaining: number;
  maxDeletes: number;
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
const CREATION_EXPIRY_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 5;
const CRON_MAX_BATCHES_PER_TARGET = 2;

async function countExpiredCreations(
  mediaType: "image" | "video",
  cutoff: string
): Promise<number> {
  const { count, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("media_type", mediaType)
    .lt("created_at", cutoff);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Expire one media kind in bounded batches. Delete library rows first, then
 * best-effort dependent metadata/storage so a cleanup failure cannot leave a
 * visible library item pointing at a removed object.
 */
export async function runCreationExpiry(
  target: CreationKind,
  opts?: {
    dryRun?: boolean;
    settings?: ExpirySettings;
    asOf?: Date;
    expectedDays?: number | null;
    maxBatches?: number;
  }
): Promise<CreationExpiryResult> {
  const settings = opts?.settings ?? (await getExpirySettings());
  const dryRun = opts?.dryRun ?? false;
  const days = daysFor(target, settings);
  const asOfDate = opts?.asOf ?? new Date();
  if (
    !Number.isFinite(asOfDate.getTime()) ||
    asOfDate.getTime() > Date.now() + 1_000
  ) {
    throw new Error("Invalid creation-expiry asOf.");
  }
  if (opts?.expectedDays !== undefined && opts.expectedDays !== days) {
    throw new Error("Expiry settings changed after preview. Preview again.");
  }
  const asOf = asOfDate.toISOString();
  const maxBatches = Math.max(
    1,
    Math.floor(opts?.maxBatches ?? DEFAULT_MAX_BATCHES)
  );
  const maxDeletes = maxBatches * CREATION_EXPIRY_BATCH_SIZE;

  if (days === null || days <= 0) {
    return {
      target,
      skipped: true,
      days,
      asOf,
      cutoff: null,
      scanned: 0,
      deletedRows: 0,
      dryRun,
      partial: false,
      remaining: 0,
      maxDeletes,
    };
  }

  const cutoff = new Date(
    asOfDate.getTime() - days * 24 * 60 * 60 * 1000
  ).toISOString();
  const mediaType = MEDIA_TYPE[target];

  if (dryRun) {
    const count = await countExpiredCreations(mediaType, cutoff);
    return {
      target,
      skipped: false,
      days,
      asOf,
      cutoff,
      scanned: count,
      deletedRows: 0,
      dryRun: true,
      partial: false,
      remaining: count,
      maxDeletes,
    };
  }

  let scanned = 0;
  let deletedRows = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const { data, error } = await supabaseServer
      .from(USER_CREATIONS_TABLE)
      .select("id, storage_path")
      .eq("media_type", mediaType)
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CREATION_EXPIRY_BATCH_SIZE);
    if (error) throw new Error(error.message);

    const rows = (data as CreationRow[] | null) ?? [];
    if (rows.length === 0) break;
    batches += 1;
    scanned += rows.length;

    // 1) Remove this batch from the user-facing library. Returning deleted rows
    // makes concurrent expiry workers safe: only the winner cleans dependencies.
    const { data: removed, error: delErr } = await supabaseServer
      .from(USER_CREATIONS_TABLE)
      .delete()
      .in(
        "id",
        rows.map((row) => row.id)
      )
      .select("id, storage_path");
    if (delErr) throw new Error(delErr.message);

    const deleted = (removed as CreationRow[] | null) ?? [];
    deletedRows += deleted.length;
    const paths = deleted
      .map((row) => row.storage_path)
      .filter((path): path is string => !!path);
    if (paths.length === 0) continue;

    // 2) Soft-delete matching platform assets (best-effort).
    const nowIso = new Date().toISOString();
    for (const batch of chunk(paths, 100)) {
      const { error: assetError } = await supabaseServer
        .from("assets")
        .update({ deleted_at: nowIso })
        .in("storage_path", batch)
        .is("deleted_at", null);
      if (assetError) {
        console.warn(
          "[creation-expiry] assets soft-delete failed:",
          assetError.message
        );
      }
    }

    // 3) Remove storage only after its library rows are confirmed deleted.
    for (const batch of chunk(paths, 100)) {
      const { error: storageError } = await supabaseServer.storage
        .from(STORAGE_BUCKET)
        .remove(batch);
      if (storageError) {
        console.warn(
          "[creation-expiry] storage remove failed:",
          storageError.message
        );
      }
    }
  }

  const remaining = await countExpiredCreations(mediaType, cutoff);
  return {
    target,
    skipped: false,
    days,
    asOf,
    cutoff,
    scanned,
    deletedRows,
    dryRun: false,
    partial: remaining > 0,
    remaining,
    maxDeletes,
  };
}

/** Run expiry for both photo and video (shared settings read). */
export async function runAllCreationExpiry(opts?: {
  dryRun?: boolean;
}): Promise<CreationExpiryResult[]> {
  const settings = await getExpirySettings({ fresh: true });
  const photo = await runCreationExpiry("photo", {
    dryRun: opts?.dryRun,
    settings,
    maxBatches: CRON_MAX_BATCHES_PER_TARGET,
  });
  const video = await runCreationExpiry("video", {
    dryRun: opts?.dryRun,
    settings,
    maxBatches: CRON_MAX_BATCHES_PER_TARGET,
  });
  return [photo, video];
}
