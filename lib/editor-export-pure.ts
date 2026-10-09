/**
 * Pure helpers for the in-system Editor export (runs FFmpeg in a Vercel Sandbox,
 * never Rendi). Self-check: `lib/editor-export-pure-self-check.ts`.
 */
import type { EditorExportSettings } from "@/lib/editor-export-settings";

export const EDITOR_EXPORT_ERRORS = {
  EDITOR_EXPORT_TIMEOUT: "Export timed out. Try a lower resolution, 30 fps or MP4, or a shorter timeline.",
  EDITOR_EXPORT_CAPACITY_REACHED:
    "Video export is paused because this month's export capacity has been used. It will be available again later.",
  EDITOR_EXPORT_BUSY: "Too many exports are running right now. Please try again in a few minutes.",
  EDITOR_EXPORT_ENCODER_FAILED: "The video encoder failed. Please try again.",
  EDITOR_EXPORT_INPUT_UNAVAILABLE: "One of your clips could not be read for export. Please try again.",
  EDITOR_EXPORT_OUT_OF_MEMORY: "The export ran out of memory. Try a lower resolution.",
  EDITOR_EXPORT_RUNNER_UNAVAILABLE: "The export service is unavailable. Please try again in a moment.",
  EDITOR_EXPORT_UPLOAD_FAILED: "The exported video could not be saved. Please try again.",
  EDITOR_EXPORT_START_TIMEOUT: "The export took too long to start. Please try again.",
  EDITOR_EXPORT_STALLED: "The export stopped making progress. Please try again.",
} as const;
export type EditorExportErrorCode = keyof typeof EDITOR_EXPORT_ERRORS;

export class EditorExportError extends Error {
  constructor(readonly code: EditorExportErrorCode) {
    super(EDITOR_EXPORT_ERRORS[code]);
    this.name = "EditorExportError";
  }
}

export type EditorExportFailureInput = {
  stage: "setup" | "encode" | "upload";
  timedOut?: boolean;
  exitCode?: number | null;
  /** Raw FFmpeg stderr. Only pattern-matched here, never stored or logged. */
  stderr?: string;
};

/** Maps a failed runner stage to a sanitized code (no URLs, tokens, or command lines). */
export function classifyEditorExportFailure(f: EditorExportFailureInput): EditorExportErrorCode {
  if (f.timedOut) return "EDITOR_EXPORT_TIMEOUT";
  if (f.stage === "setup") return "EDITOR_EXPORT_RUNNER_UNAVAILABLE";
  if (f.stage === "upload") return "EDITOR_EXPORT_UPLOAD_FAILED";
  const err = f.stderr ?? "";
  if (f.exitCode === 137 || /cannot allocate memory|out of memory|\bkilled\b/i.test(err)) {
    return "EDITOR_EXPORT_OUT_OF_MEMORY";
  }
  if (/server returned|http error|forbidden|not found|connection (refused|reset|timed out)|invalid data found|input\/output error|end of file/i.test(err)) {
    return "EDITOR_EXPORT_INPUT_UNAVAILABLE";
  }
  return "EDITOR_EXPORT_ENCODER_FAILED";
}

/** Error JSON stored on the job/step/asset/request: sanitized message + stable code. */
export function editorExportErrorJson(code: EditorExportErrorCode): { message: string; code: EditorExportErrorCode } {
  return { message: EDITOR_EXPORT_ERRORS[code], code };
}

/** Hobby plan limits (https://vercel.com/docs/sandbox/pricing): 45 min session, 4 vCPU. */
export const HOBBY_MAX_SESSION_MS = 45 * 60 * 1000;
export const HOBBY_MAX_VCPUS = 4;
/** 5 minute margin under the plan max: the session also covers setup, input reads and the upload. */
export const DEFAULT_EXPORT_TIMEOUT_MS = 40 * 60 * 1000;

type EnvLike = Record<string, string | undefined>;
const positiveInt = (v: string | undefined): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

/** Sandbox lifetime and poll budget: default 40 min, clamped to the plan max (`EDITOR_EXPORT_PLAN_MAX_MS`). */
export function editorExportTimeoutMs(env: EnvLike): number {
  const ceiling = positiveInt(env.EDITOR_EXPORT_PLAN_MAX_MS) ?? HOBBY_MAX_SESSION_MS;
  return Math.min(positiveInt(env.EDITOR_EXPORT_TIMEOUT_MS) ?? DEFAULT_EXPORT_TIMEOUT_MS, ceiling);
}

/** vCPUs for the encode, never above the plan max (`EDITOR_EXPORT_MAX_VCPUS`, default 4). No length/fps cap. */
export function editorExportVcpus(settings: Pick<EditorExportSettings, "resolution">, env: EnvLike = {}): number {
  const want = settings.resolution >= 2160 ? 8 : settings.resolution >= 1080 ? 4 : 2;
  return Math.min(want, positiveInt(env.EDITOR_EXPORT_MAX_VCPUS) ?? HOBBY_MAX_VCPUS);
}

/** Encode poll interval by poll index (workflow code must stay deterministic): 3 s for ~2 min, then 12 s to save Workflow events. */
export function editorExportEncodePollMs(pollIndex: number): number {
  return pollIndex < 40 ? 3_000 : 12_000;
}

/**
 * Per-phase limits for the encode start step. Their sum (255 s) stays under the 300 s function limit, so a hung
 * phase fails the export instead of the step being killed and retried. Constants, not env knobs.
 */
export const EDITOR_EXPORT_PHASE_TIMEOUT_MS = {
  /** Signing every media path. */
  sign: 30_000,
  /** Audio stream probe (10 s per source inside). */
  probe: 45_000,
  /** `Sandbox.create` (snapshot boot). */
  create: 60_000,
  /** Pinned-tool install fallback + capability check. */
  prepare: 90_000,
  /** Launching FFmpeg detached. */
  ffmpegStart: 30_000,
} as const;
export type EditorExportPhase = keyof typeof EDITOR_EXPORT_PHASE_TIMEOUT_MS;

/** Encode fails when FFmpeg's `out_time_us` has not advanced for this long. The 40 min budget still applies. */
export const EDITOR_EXPORT_STALL_MS = 5 * 60 * 1000;

export class EditorExportPhaseTimeout extends Error {
  constructor(readonly phase: EditorExportPhase) {
    super(`editor export phase timed out: ${phase}`);
    this.name = "EditorExportPhaseTimeout";
  }
}

/** Races `work` against the phase limit; the loser is not cancelled, so callers stop the sandbox on timeout. */
export function withPhaseTimeout<T>(phase: EditorExportPhase, work: Promise<T>, ms: number = EDITOR_EXPORT_PHASE_TIMEOUT_MS[phase]): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EditorExportPhaseTimeout(phase)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Encode stall tracker carried between polls: the furthest `out_time_us` seen and when it last advanced. */
export type EncodeStall = { outUs: number | null; sinceMs: number };

/** Advances the tracker with this poll's reading; `stalled` once nothing advanced for `EDITOR_EXPORT_STALL_MS`. */
export function nextEncodeStall(prev: EncodeStall | null, outUs: number | null, nowMs: number): { stall: EncodeStall; stalled: boolean } {
  const advanced = outUs != null && (prev?.outUs == null || outUs > prev.outUs);
  const stall = !prev || advanced ? { outUs: advanced ? outUs : null, sinceMs: nowMs } : prev;
  return { stall, stalled: nowMs - stall.sinceMs >= EDITOR_EXPORT_STALL_MS };
}

/**
 * Maps a failed `Sandbox.create` to a sanitized code from the SDK's APIError HTTP status.
 * ponytail: statuses are the conventional ones (429 rate limit, 402 quota); the real shape of a paused/limited
 * create is unverified without live Sandbox credentials. Anything else stays RUNNER_UNAVAILABLE.
 */
export function classifySandboxCreateError(e: unknown): EditorExportErrorCode {
  const status = (e as { response?: { status?: number } } | null)?.response?.status;
  if (status === 429) return "EDITOR_EXPORT_BUSY";
  if (status === 402) return "EDITOR_EXPORT_CAPACITY_REACHED";
  return "EDITOR_EXPORT_RUNNER_UNAVAILABLE";
}

/** `curl` argv that PUTs the file to a Supabase signed upload URL (mirrors storage-js raw-body upload). */
export function signedUploadArgs(p: { url: string; file: string; contentType: string; cacheControl: string }): string[] {
  return [
    "--fail", "--silent", "--show-error",
    "--request", "PUT",
    "--upload-file", p.file,
    "--header", `content-type: ${p.contentType}`,
    "--header", `cache-control: max-age=${p.cacheControl}`,
    "--header", "x-upsert: false",
    p.url,
  ];
}
