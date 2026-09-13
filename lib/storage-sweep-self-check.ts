import { readFileSync } from "node:fs";
import {
  classifySweepObject,
  convertedTikTokSiblingPath,
  shouldSweepConvertedTikTokSibling,
} from "./storage-sweep-pure";

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

  const sibling = convertedTikTokSiblingPath(`${userId}/photos/uploads/scheduler/shot.png`);
  assert(
    sibling === `${userId}/photos/uploads/scheduler/shot.tiktok.jpg`,
    "TikTok JPEG siblings must sit next to the source",
  );
  assert(
    shouldSweepConvertedTikTokSibling({
      siblingPath: sibling,
      listedPaths: new Set([sibling]),
      cutoffMs,
      createdAtMs: oldMs,
    }),
    "converted .tiktok.jpg must be swept when the source object is gone",
  );
  assert(
    !shouldSweepConvertedTikTokSibling({
      siblingPath: sibling,
      listedPaths: new Set([sibling, `${userId}/photos/uploads/scheduler/shot.png`]),
      cutoffMs,
      createdAtMs: oldMs,
    }),
    "converted .tiktok.jpg must stay while the source object remains",
  );

  const auditSource = readFileSync(
    new URL("./storage-orphan-audit.ts", import.meta.url),
    "utf8",
  );
  assert(
    /\.range\(from, from \+ STORAGE_REF_PAGE_SIZE - 1\)/.test(auditSource),
    "collectStorageReferences must page past PostgREST's default row cap",
  );

  const skillConfigs = readFileSync(
    new URL("./skill-configs-db.ts", import.meta.url),
    "utf8",
  );
  assert(
    /removeLeftoverSkillThumbs/.test(skillConfigs),
    "thumb replace must sweep unused prior objects under platform/skills/{slug}/",
  );
}

storageSweepSelfCheck();
console.log("storage-sweep self-check passed");
