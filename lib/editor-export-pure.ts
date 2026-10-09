/**
 * Pure helpers for the in-system Editor export (runs FFmpeg in a Vercel Sandbox,
 * never Rendi). Runnable as `npx tsx lib/editor-export-pure.ts`.
 */
import type { EditorExportSettings } from "@/lib/editor-export-settings";

export const EDITOR_EXPORT_ERRORS = {
  EDITOR_EXPORT_TIMEOUT: "Export timed out.",
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

/** vCPUs for the encode: 4K is memory hungry; no length/fps cap, only bigger machines. */
export function editorExportVcpus(settings: Pick<EditorExportSettings, "resolution">): number {
  return settings.resolution >= 1080 ? (settings.resolution >= 2160 ? 8 : 4) : 2;
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
  const args = signedUploadArgs({ url: "https://x/y", file: "export/o.mp4", contentType: "video/mp4", cacheControl: "31536000, immutable" });
  assert(args.includes("cache-control: max-age=31536000, immutable") && args.at(-1) === "https://x/y", "signed upload argv");
}

if (require.main === module) {
  editorExportPureSelfCheck();
  console.log("editorExportPureSelfCheck: ok");
}
