import { classifySweepObject } from "./storage-sweep-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`storage-sweep self-check: ${message}`);
}

export function storageSweepSelfCheck(): void {
  const now = Date.parse("2026-09-12T12:00:00.000Z");
  const cutoffMs = now - 24 * 60 * 60 * 1000;
  const oldMs = cutoffMs - 60_000;
  const youngMs = cutoffMs + 60_000;
  const userId = "user-owner-1";
  const jobId = "job-recover-1";
  const resumable = `${userId}/resumable/${jobId}/scenes/scene_0.mp4`;
  const prefixOnlyBlob = `${userId}/resumable/${jobId}`;

  const resumableOld = classifySweepObject({
    path: resumable,
    createdAtMs: oldMs,
    cutoffMs,
    refBlob: prefixOnlyBlob,
  });
  assert(
    resumableOld.action === "keep",
    "recoverable staging older than 24h must not be swept (reconcile owns purge)",
  );

  const tempOld = classifySweepObject({
    path: `${userId}/videos/temp/captions.ass`,
    createdAtMs: oldMs,
    cutoffMs,
    refBlob: "",
  });
  assert(tempOld.action === "delete" && tempOld.reason === "temp", "old videos/temp must be swept");

  const orphanOld = classifySweepObject({
    path: `${userId}/videos/generated/video/t2v/orphan.mp4`,
    createdAtMs: oldMs,
    cutoffMs,
    refBlob: "",
  });
  assert(
    orphanOld.action === "delete" && orphanOld.reason === "orphan",
    "old unreferenced video must be swept",
  );

  const referenced = classifySweepObject({
    path: `${userId}/videos/generated/video/t2v/kept.mp4`,
    createdAtMs: oldMs,
    cutoffMs,
    refBlob: `${userId}/videos/generated/video/t2v/kept.mp4`,
  });
  assert(referenced.action === "keep", "referenced video must be kept");

  const youngOrphan = classifySweepObject({
    path: `${userId}/videos/generated/video/t2v/fresh.mp4`,
    createdAtMs: youngMs,
    cutoffMs,
    refBlob: "",
  });
  assert(youngOrphan.action === "keep", "young unreferenced video must be kept");

  const missingTs = classifySweepObject({
    path: `${userId}/videos/generated/video/t2v/nots.mp4`,
    createdAtMs: null,
    cutoffMs,
    refBlob: "",
  });
  assert(missingTs.action === "keep", "missing timestamp must be kept");
}

storageSweepSelfCheck();
console.log("storage-sweep self-check passed");
