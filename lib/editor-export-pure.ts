/**
 * Pure helpers for the in-system Editor export (runs FFmpeg in a Vercel Sandbox,
 * never Rendi). Runnable as `npx tsx lib/editor-export-pure.ts`.
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-export self-check: ${msg}`);
}

export function editorExportPureSelfCheck(): void {
  const c = classifyEditorExportFailure;
  assert(c({ stage: "encode", timedOut: true }) === "EDITOR_EXPORT_TIMEOUT", "timeout");
  assert(c({ stage: "setup" }) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE", "setup failure");
  assert(c({ stage: "upload", exitCode: 22 }) === "EDITOR_EXPORT_UPLOAD_FAILED", "upload failure");
  assert(c({ stage: "encode", exitCode: 137 }) === "EDITOR_EXPORT_OUT_OF_MEMORY", "oom exit code");
  assert(c({ stage: "encode", exitCode: 1, stderr: "HTTP error 403 Forbidden" }) === "EDITOR_EXPORT_INPUT_UNAVAILABLE", "input 403");
  assert(c({ stage: "encode", exitCode: 1, stderr: "Error while filtering" }) === "EDITOR_EXPORT_ENCODER_FAILED", "generic encoder failure");
  for (const code of Object.keys(EDITOR_EXPORT_ERRORS) as EditorExportErrorCode[]) {
    assert(!/[\u0080-￿]/.test(EDITOR_EXPORT_ERRORS[code]) && !/https?:|token/i.test(EDITOR_EXPORT_ERRORS[code]), `${code} message is plain English`);
  }
  assert(editorExportVcpus({ resolution: 720 }) === 2 && editorExportVcpus({ resolution: 1080 }) === 4, "runner sizing");
  assert(editorExportVcpus({ resolution: 480 }) === 2 && editorExportVcpus({ resolution: 2160 }) === 4, "4K clamped to Hobby");
  assert(editorExportVcpus({ resolution: 2160 }, { EDITOR_EXPORT_MAX_VCPUS: "8" }) === 8, "vcpu ceiling env");
  assert(editorExportVcpus({ resolution: 2160 }, { EDITOR_EXPORT_MAX_VCPUS: "junk" }) === 4, "invalid vcpu env");
  const t = editorExportTimeoutMs;
  assert(t({}) === 40 * 60_000, "default timeout 40 min");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "999999999" }) === 45 * 60_000, "timeout clamped to plan max");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "60000" }) === 60_000, "timeout override below ceiling");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "abc" }) === 40 * 60_000 && t({ EDITOR_EXPORT_TIMEOUT_MS: "-5" }) === 40 * 60_000, "invalid timeout env");
  assert(t({ EDITOR_EXPORT_TIMEOUT_MS: "999999999", EDITOR_EXPORT_PLAN_MAX_MS: "7200000" }) === 7_200_000, "plan max env");
  assert(editorExportEncodePollMs(0) === 3_000 && editorExportEncodePollMs(40) === 12_000, "adaptive poll");
  const apiErr = (status: number) => ({ response: { status } });
  assert(classifySandboxCreateError(apiErr(429)) === "EDITOR_EXPORT_BUSY", "429 busy");
  assert(classifySandboxCreateError(apiErr(402)) === "EDITOR_EXPORT_CAPACITY_REACHED", "402 capacity");
  assert(classifySandboxCreateError(apiErr(500)) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE" && classifySandboxCreateError(null) === "EDITOR_EXPORT_RUNNER_UNAVAILABLE", "other create errors");
  const args = signedUploadArgs({ url: "https://x/y", file: "export/o.mp4", contentType: "video/mp4", cacheControl: "31536000, immutable" });
  assert(args.includes("cache-control: max-age=31536000, immutable") && args.at(-1) === "https://x/y", "signed upload argv");
}

if (require.main === module) {
  editorExportPureSelfCheck();
  console.log("editorExportPureSelfCheck: ok");
}
