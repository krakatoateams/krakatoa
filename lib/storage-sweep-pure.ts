import { isResumablePath, isVideosTempPath } from "@/lib/storage-buckets";
import { convertedTikTokSiblingPath } from "@/lib/post-storage-cleanup-pure";

export { convertedTikTokSiblingPath };

export function tiktokSiblingSourcePrefix(siblingPath: string): string | null {
  if (!siblingPath.endsWith(".tiktok.jpg")) return null;
  return siblingPath.slice(0, -".tiktok.jpg".length);
}

export function shouldSweepConvertedTikTokSibling(opts: {
  siblingPath: string;
  listedPaths: Set<string>;
  cutoffMs: number;
  createdAtMs: number | null;
}): boolean {
  const prefix = tiktokSiblingSourcePrefix(opts.siblingPath);
  if (!prefix) return false;
  const isOldEnough = opts.createdAtMs !== null && opts.createdAtMs < opts.cutoffMs;
  if (!isOldEnough) return false;
  for (const path of opts.listedPaths) {
    if (path === opts.siblingPath) continue;
    if (path.startsWith(`${prefix}.`)) return false;
  }
  return true;
}

export type SweepDecision =
  | { action: "keep" }
  | { action: "delete"; reason: "temp" | "orphan" };

/**
 * Conservative reference test: full path OR basename match in the ref blob.
 * Over-inclusive on purpose — keep when uncertain.
 */
export function sweepPathIsReferenced(path: string, refBlob: string): boolean {
  if (refBlob.includes(path)) return true;
  const bn = path.split("/").pop() ?? "";
  return bn.length > 0 && refBlob.includes(bn);
}

/**
 * Decide whether a listed object is deletable by the videos sweep.
 *
 * Recovery staging is owned by generation-reconcile / job settlement, not this
 * sweep. Prefix-only job refs do not protect child artifact paths, so treating
 * `{userId}/resumable/{jobId}/…` as a videos orphan would delete in-use
 * recovery files after 24h (and before the 05:00 reconcile cron).
 */
export function classifySweepObject(opts: {
  path: string;
  createdAtMs: number | null;
  cutoffMs: number;
  refBlob: string;
}): SweepDecision {
  const { path, createdAtMs, cutoffMs, refBlob } = opts;
  const isOldEnough = createdAtMs !== null && createdAtMs < cutoffMs;

  if (isResumablePath(path)) return { action: "keep" };

  const isTemp = isVideosTempPath(path);

  if (isTemp) {
    return isOldEnough ? { action: "delete", reason: "temp" } : { action: "keep" };
  }

  if (!sweepPathIsReferenced(path, refBlob) && isOldEnough) {
    return { action: "delete", reason: "orphan" };
  }
  return { action: "keep" };
}
