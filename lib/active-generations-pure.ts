import { CREATION_TOOLS, type CreationTool } from "./creations";
import { getPhotoFeature, isPhotoFeatureKey } from "./creation-features";

/**
 * User-facing view of an in-flight / recently-failed generation job.
 * Pure — no React, no Supabase — so the mapping stays runnable as a self-check.
 */

export const FAILED_LOOKBACK_MS = 15 * 60 * 1000;

export type ActiveGenerationStatus = "queued" | "running" | "recoverable" | "failed";

export type ActiveGeneration = {
  jobId: string;
  jobType: string;
  label: string;
  href: string;
  navHref: string;
  creationTool: CreationTool | null;
  mediaType: "image" | "video";
  status: ActiveGenerationStatus;
  phase: string | null;
  idempotencyKey: string | null;
  cancelAllowed: boolean;
  errorMessage: string | null;
  createdAt: string;
};

export const LIVE_JOB_STATUSES = ["queued", "running", "recoverable"] as const;

type JobTypeSpec = {
  label: string;
  href: string;
  navHref: string;
  creationTool: CreationTool;
};

const VIDEO = "/tools/video";
const PHOTO = "/tools/photo-v2";

const JOB_TYPE_SPEC: Record<string, JobTypeSpec> = {
  video_text2video: {
    label: CREATION_TOOLS.video_text2video.label,
    href: `${VIDEO}?type=text2video`,
    navHref: VIDEO,
    creationTool: "video_text2video",
  },
  video_image2video: {
    label: CREATION_TOOLS.video_image2video.label,
    href: `${VIDEO}?type=image2video`,
    navHref: VIDEO,
    creationTool: "video_image2video",
  },
  video_motion_control: {
    label: CREATION_TOOLS.video_motion_control.label,
    href: `${VIDEO}?type=motion_control`,
    navHref: VIDEO,
    creationTool: "video_motion_control",
  },
  reels_seedance: {
    label: CREATION_TOOLS.reels_seedance.label,
    href: `${VIDEO}?type=reels-creator`,
    navHref: VIDEO,
    creationTool: "reels_seedance",
  },
  veo_single: {
    label: CREATION_TOOLS.reels_veo.label,
    href: `${VIDEO}?type=reels-creator`,
    navHref: VIDEO,
    creationTool: "reels_veo",
  },
  veo_perscene: {
    label: CREATION_TOOLS.reels_veo.label,
    href: `${VIDEO}?type=reels-creator`,
    navHref: VIDEO,
    creationTool: "reels_veo",
  },
  storyboard_video: {
    label: CREATION_TOOLS.storyboard_video.label,
    href: `${VIDEO}?type=storyboard`,
    navHref: VIDEO,
    creationTool: "storyboard_video",
  },
  storyboard_image: {
    label: CREATION_TOOLS.storyboard.label,
    href: `${PHOTO}?type=storyboard`,
    navHref: PHOTO,
    creationTool: "storyboard",
  },
  storyboard_import: {
    label: CREATION_TOOLS.storyboard.label,
    href: `${PHOTO}?type=storyboard`,
    navHref: PHOTO,
    creationTool: "storyboard",
  },
  product_photo: {
    label: CREATION_TOOLS.product_photo.label,
    href: PHOTO,
    navHref: PHOTO,
    creationTool: "product_photo",
  },
};

export function isActiveGenerationStatus(value: string): value is ActiveGenerationStatus {
  return value === "queued" || value === "running" || value === "recoverable" || value === "failed";
}

export function specForJobType(jobType: string): JobTypeSpec | null {
  return JOB_TYPE_SPEC[jobType] ?? null;
}

export function photoLabel(mode: unknown): string {
  if (typeof mode === "string" && isPhotoFeatureKey(mode)) return getPhotoFeature(mode).label;
  return CREATION_TOOLS.product_photo.label;
}

export function errorMessageOf(error: Record<string, unknown> | null | undefined): string | null {
  if (!error) return null;
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  if (typeof error.code === "string" && error.code.trim()) return error.code.trim();
  return null;
}

export function describeJob(params: {
  jobId: string;
  jobType: string;
  status: string;
  createdAt: string;
  input?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  phase?: string | null;
  idempotencyKey?: string | null;
  cancelAllowed?: boolean;
}): ActiveGeneration | null {
  if (!isActiveGenerationStatus(params.status)) return null;
  const spec = specForJobType(params.jobType);
  if (!spec) return null;
  const label = params.jobType === "product_photo" ? photoLabel(params.input?.mode) : spec.label;
  return {
    jobId: params.jobId,
    jobType: params.jobType,
    label,
    href: spec.href,
    navHref: spec.navHref,
    creationTool: spec.creationTool,
    mediaType: CREATION_TOOLS[spec.creationTool].mediaType,
    status: params.status,
    phase: params.phase ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    cancelAllowed: params.cancelAllowed ?? false,
    errorMessage: params.status === "failed" || params.status === "recoverable"
      ? errorMessageOf(params.error)
      : null,
    createdAt: params.createdAt,
  };
}

export function filterActiveGenerations(
  items: ActiveGeneration[],
  opts?: { tools?: CreationTool[]; mediaType?: "image" | "video" },
): ActiveGeneration[] {
  return items.filter((item) => {
    if (opts?.tools?.length && (!item.creationTool || !opts.tools.includes(item.creationTool))) {
      return false;
    }
    if (opts?.mediaType && item.mediaType !== opts.mediaType) return false;
    return true;
  });
}

export function isLiveStatus(status: ActiveGenerationStatus): boolean {
  return status === "queued" || status === "running";
}

export type MatchableRequest = {
  jobId: string | null;
  idempotencyKey: string;
  cancelAllowed: boolean;
};

/** Direct job_id only — a time-window guess can cancel the wrong in-flight attempt. */
export function matchRequestsToJobs(
  jobs: { id: string }[],
  requests: MatchableRequest[],
): Map<string, { idempotencyKey: string; cancelAllowed: boolean }> {
  const jobIds = new Set(jobs.map((j) => j.id));
  const out = new Map<string, { idempotencyKey: string; cancelAllowed: boolean }>();
  for (const req of requests) {
    if (req.jobId && jobIds.has(req.jobId)) {
      out.set(req.jobId, { idempotencyKey: req.idempotencyKey, cancelAllowed: req.cancelAllowed });
    }
  }
  return out;
}

export function isCurrentTool(pathname: string | null | undefined, navHref: string): boolean {
  if (!pathname) return false;
  return pathname === navHref || pathname.startsWith(`${navHref}/`);
}

export function humanizePhase(stepKey: string | null | undefined): string | null {
  if (!stepKey?.trim()) return null;
  return stepKey.replace(/_/g, " ");
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`active-generations self-check: ${msg}`);
}

export function activeGenerationsSelfCheck(): void {
  const i2v = describeJob({
    jobId: "j1",
    jobType: "video_image2video",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  assert(i2v?.href === "/tools/video?type=image2video", "i2v deep-links to the composer");
  assert(i2v?.creationTool === "video_image2video", "i2v maps to history tool filter");
  assert(i2v?.navHref === "/tools/video", "i2v badges the Video nav item");
  assert(i2v?.mediaType === "video", "i2v is video");

  const veo = describeJob({
    jobId: "j2",
    jobType: "veo_perscene",
    status: "queued",
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  assert(veo?.creationTool === "reels_veo", "veo job_type maps to reels_veo history tool");
  assert(veo?.href === "/tools/video?type=reels-creator", "veo lands on Reels Creator");

  const photo = describeJob({
    jobId: "j3",
    jobType: "product_photo",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
    input: { mode: "social" },
  });
  assert(photo?.label === "Social media post", "photo label comes from input.mode");
  assert(photo?.href === "/tools/photo-v2", "photo studio has no per-mode type param");

  const storyboard = describeJob({
    jobId: "j4",
    jobType: "storyboard_image",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
  });
  assert(storyboard?.href === "/tools/photo-v2?type=storyboard", "storyboard image deep-links");
  assert(storyboard?.creationTool === "storyboard", "storyboard image filters the storyboard history");

  assert(describeJob({
    jobId: "x",
    jobType: "video_image2video",
    status: "succeeded",
    createdAt: "2026-08-14T00:00:00.000Z",
  }) === null, "succeeded jobs are not active");

  assert(describeJob({
    jobId: "x",
    jobType: "unknown_tool",
    status: "running",
    createdAt: "2026-08-14T00:00:00.000Z",
  }) === null, "unknown job types are dropped, not shown as a broken tile");

  const failed = describeJob({
    jobId: "j5",
    jobType: "video_image2video",
    status: "failed",
    createdAt: "2026-08-14T00:00:00.000Z",
    error: { message: "Seedance timed out" },
  });
  assert(failed?.errorMessage === "Seedance timed out", "failed jobs surface the error message");

  const filtered = filterActiveGenerations(
    [i2v!, veo!, photo!],
    { tools: ["video_image2video", "video_text2video"] },
  );
  assert(filtered.length === 1 && filtered[0].jobId === "j1", "history tiles honor the tools filter");

  const matched = matchRequestsToJobs(
    [
      { id: "job-linked" },
      { id: "job-unlinked" },
    ],
    [
      { jobId: "job-linked", idempotencyKey: "key-linked", cancelAllowed: false },
      { jobId: null, idempotencyKey: "key-orphan", cancelAllowed: true },
    ],
  );
  assert(matched.get("job-linked")?.idempotencyKey === "key-linked", "direct job_id match wins");
  assert(matched.get("job-linked")?.cancelAllowed === false, "cancelAllowed rides along");
  assert(!matched.has("job-unlinked"), "unlinked jobs do not guess a key");

  assert(isCurrentTool("/tools/video", "/tools/video"), "video page is the video tool");
  assert(isCurrentTool("/tools/video/x", "/tools/video"), "nested video path is still the video tool");
  assert(!isCurrentTool("/dashboard", "/tools/video"), "dashboard is not the video tool");
  assert(!isCurrentTool("/tools/photo-v2", "/tools/video"), "photo page is not the video tool");

  assert(humanizePhase("video_generation") === "video generation", "phase is readable");
  assert(humanizePhase(null) === null, "missing phase stays null");
}

if (require.main === module) {
  activeGenerationsSelfCheck();
  console.log("activeGenerationsSelfCheck: ok");
}
