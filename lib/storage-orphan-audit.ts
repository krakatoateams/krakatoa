/**
 * List orphan / transient storage objects under `videos/` and `photos/`.
 * Read-only audit — use `runStorageSweep` to delete videos/ only.
 */
import { supabaseServer } from "@/lib/supabase-server";
import {
  PHOTOS_FOLDER,
  STORAGE_BUCKET,
  VIDEOS_FOLDER,
  isVideosTempPath,
} from "@/lib/storage-buckets";

export const DEFAULT_ORPHAN_MIN_AGE_HOURS = 24;

export type OrphanReason = "temp" | "orphan" | "orphan-young" | "referenced";

export interface StorageObjectRow {
  path: string;
  size: number;
  createdAtMs: number | null;
  root: "videos" | "photos";
}

export interface OrphanAuditRow extends StorageObjectRow {
  reason: OrphanReason;
  ageHours: number | null;
}

export interface OrphanAuditPlan {
  referenced: OrphanAuditRow[];
  deletable: OrphanAuditRow[];
  totals: {
    scanned: number;
    referenced: number;
    deletable: number;
    deletableBytes: number;
    byRoot: { videos: number; photos: number };
    byReason: Record<OrphanReason, number>;
  };
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
export async function listAllObjects(prefix: string): Promise<StorageObjectRow[]> {
  const root: "videos" | "photos" = prefix.startsWith(`${PHOTOS_FOLDER}/`)
    ? "photos"
    : "videos";
  const out: StorageObjectRow[] = [];

  async function walk(p: string): Promise<void> {
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const { data, error } = await supabaseServer.storage
        .from(STORAGE_BUCKET)
        .list(p, { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`storage.list failed at "${p}": ${error.message}`);
      const entries = (data ?? []) as StorageListEntry[];
      for (const e of entries) {
        const full = p ? `${p}/${e.name}` : e.name;
        if (e.id === null) {
          await walk(full);
        } else {
          out.push({
            path: full,
            size: e.metadata?.size ?? 0,
            createdAtMs: toMs(e.created_at) ?? toMs(e.updated_at),
            root: full.startsWith(`${PHOTOS_FOLDER}/`) ? "photos" : root,
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

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Conservative reference test: full path OR basename match in the ref blob.
 * Over-inclusive on purpose — keep when uncertain.
 */
export function isReferenced(path: string, refBlob: string): boolean {
  if (refBlob.includes(path)) return true;
  const bn = basename(path);
  return bn.length > 0 && refBlob.includes(bn);
}

/** Every DB string that may reference a bucket object. */
export async function collectStorageReferences(): Promise<string> {
  const refs: string[] = [];

  async function pull(table: string, columns: string[]): Promise<void> {
    const { data, error } = await supabaseServer.from(table).select(columns.join(","));
    if (error) {
      console.warn(`[orphan-audit] skip table ${table}: ${error.message}`);
      return;
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      for (const col of columns) {
        const v = row[col];
        if (typeof v === "string" && v) {
          refs.push(v);
          try {
            const decoded = decodeURIComponent(v);
            if (decoded !== v) refs.push(decoded);
          } catch {
            // ignore malformed URI
          }
        }
      }
    }
  }

  await pull("assets", ["storage_path", "public_url"]);
  await pull("user_creations", ["media_url", "storage_path"]);
  await pull("posts", ["video_url"]);
  await pull("storyboards", ["video_url", "storyboard_url"]);

  return refs.join("\n");
}

function isTransientPath(path: string): boolean {
  return isVideosTempPath(path);
}

function ageHours(createdAtMs: number | null): number | null {
  if (createdAtMs === null) return null;
  return (Date.now() - createdAtMs) / (60 * 60 * 1000);
}

/**
 * Audit `videos/` + `photos/` for orphans and transient files.
 * `deletable` = temp (age-gated) or orphan older than minAgeHours.
 * `referenced` includes young orphans still protected by the age guard.
 */
export async function planOrphanAudit(
  minAgeHours: number = DEFAULT_ORPHAN_MIN_AGE_HOURS,
  opts?: { includeYoungOrphans?: boolean },
): Promise<OrphanAuditPlan> {
  const includeYoung = opts?.includeYoungOrphans ?? false;
  const [videoObjects, photoObjects, refBlob] = await Promise.all([
    listAllObjects(VIDEOS_FOLDER),
    listAllObjects(PHOTOS_FOLDER),
    collectStorageReferences(),
  ]);
  const objects = [...videoObjects, ...photoObjects];
  const cutoffMs = Date.now() - minAgeHours * 60 * 60 * 1000;

  const referenced: OrphanAuditRow[] = [];
  const deletable: OrphanAuditRow[] = [];
  const byReason: Record<OrphanReason, number> = {
    temp: 0,
    orphan: 0,
    "orphan-young": 0,
    referenced: 0,
  };

  for (const obj of objects) {
    const hrs = ageHours(obj.createdAtMs);
    const row: OrphanAuditRow = {
      ...obj,
      reason: "referenced",
      ageHours: hrs !== null ? Math.round(hrs * 10) / 10 : null,
    };

    const isTemp = isTransientPath(obj.path);
    const isOldEnough = obj.createdAtMs !== null && obj.createdAtMs < cutoffMs;
    const ref = isReferenced(obj.path, refBlob);

    if (isTemp) {
      row.reason = isOldEnough ? "temp" : "orphan-young";
    } else if (ref) {
      row.reason = "referenced";
    } else if (!isOldEnough) {
      row.reason = "orphan-young";
    } else {
      row.reason = "orphan";
    }

    byReason[row.reason]++;

    if (row.reason === "orphan" || row.reason === "temp") {
      deletable.push(row);
    } else if (row.reason === "orphan-young" && includeYoung) {
      deletable.push(row);
    } else {
      referenced.push(row);
    }
  }

  const sum = (arr: OrphanAuditRow[]) => arr.reduce((a, o) => a + o.size, 0);

  return {
    referenced,
    deletable,
    totals: {
      scanned: objects.length,
      referenced: referenced.length,
      deletable: deletable.length,
      deletableBytes: sum(deletable),
      byRoot: {
        videos: deletable.filter((o) => o.root === "videos").length,
        photos: deletable.filter((o) => o.root === "photos").length,
      },
      byReason,
    },
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Human-readable CLI summary. */
export function formatOrphanAuditReport(plan: OrphanAuditPlan): string {
  const lines: string[] = [
    `Scanned: ${plan.totals.scanned} objects`,
    `Referenced / protected: ${plan.totals.referenced}`,
    `Deletable: ${plan.totals.deletable} (${formatBytes(plan.totals.deletableBytes)})`,
    `  videos/: ${plan.totals.byRoot.videos} · photos/: ${plan.totals.byRoot.photos}`,
    `  temp: ${plan.totals.byReason.temp} · orphan: ${plan.totals.byReason.orphan} · young: ${plan.totals.byReason["orphan-young"]}`,
    "",
  ];

  if (!plan.deletable.length) {
    lines.push("No deletable orphans found.");
    return lines.join("\n");
  }

  lines.push("Deletable paths:");
  for (const o of plan.deletable.sort((a, b) => a.path.localeCompare(b.path))) {
    const age = o.ageHours !== null ? `${o.ageHours}h` : "?h";
    lines.push(`  [${o.reason}] ${o.path}  (${formatBytes(o.size)}, ${age})`);
  }
  return lines.join("\n");
}
