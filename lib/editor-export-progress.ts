// Pure stage/percentage model for the Video Editor export progress dialog (#300).
// Percentages come only from real signals; no signal means null (indeterminate).

// Encode step order: preparing (sign + probe media) -> starting (boot runner, verify FFmpeg) -> encoding.
export type ExportStage = "uploading" | "preparing" | "starting" | "encoding" | "saving" | "finalizing";

export const EXPORT_STAGE_LABEL: Record<ExportStage, string> = {
  uploading: "Uploading media",
  preparing: "Preparing media",
  starting: "Starting the encoder",
  encoding: "Encoding video",
  saving: "Saving to your library",
  finalizing: "Finalizing",
};

const STAGES = new Set<string>(Object.keys(EXPORT_STAGE_LABEL));

/** Progress object the runner writes onto the running job step's `output`. */
export type ExportProgress = { stage: ExportStage; progressPct: number | null; updatedAt: string };

export function stageFromStepKey(stepKey: string | null | undefined): ExportStage {
  if (!stepKey) return "preparing";
  // Until the runner reports real encode progress, the encode step is still booting the encoder.
  return stepKey === "storage_upload" ? "saving" : "preparing";
}

/** FFmpeg `-progress` out_time_us over timeline duration, clamped to 0-99 until verified. */
export function encodePct(outTimeUs: number, totalSec: number): number | null {
  if (!Number.isFinite(outTimeUs) || !Number.isFinite(totalSec) || totalSec <= 0 || outTimeUs < 0) return null;
  return Math.min(99, Math.floor((outTimeUs / 1e6 / totalSec) * 100));
}

/** Read the `progress` object from an untrusted status payload; null when malformed. */
export function parseExportProgress(raw: unknown): ExportProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.stage !== "string" || !STAGES.has(r.stage)) return null;
  const pct = typeof r.progressPct === "number" && Number.isFinite(r.progressPct) ? r.progressPct : null;
  return {
    stage: r.stage as ExportStage,
    progressPct: pct == null ? null : Math.max(0, Math.min(99, Math.floor(pct))),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/** Keeps a displayed percentage from going backwards within a stage. */
export function monotonicPct(prev: { stage: ExportStage; pct: number | null } | null, next: ExportProgress): number | null {
  if (next.progressPct == null) return null;
  return prev && prev.stage === next.stage && prev.pct != null ? Math.max(prev.pct, next.progressPct) : next.progressPct;
}

/** No visible change (stage, percent, upload count) for this long shows the "taking longer" hint. */
export const EXPORT_SLOW_HINT_MS = 60_000;

export function exportLooksSlow(changedAtMs: number, nowMs: number): boolean {
  return nowMs - changedAtMs >= EXPORT_SLOW_HINT_MS;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function stageValueText(stage: ExportStage, pct: number | null): string {
  return pct == null ? EXPORT_STAGE_LABEL[stage] : `${EXPORT_STAGE_LABEL[stage]}, ${pct} percent`;
}

// Cancel wait (#326): after Cancel, a terminal status should arrive within seconds; the wait is always bounded.
export const CANCEL_STILL_STOPPING_MS = 10_000;
export const CANCEL_GIVE_UP_MS = 30_000;
export const CANCEL_STILL_STOPPING_NOTE = "Still stopping. This can take a moment.";
export const CANCEL_FAILED_NOTE = "Couldn't cancel. Try again.";
export const CANCEL_ABANDONED_MESSAGE = "Cancel was sent. The export may take a moment to stop.";
/** Hard cap on waiting for an accepted export: the 45 min plan budget plus a margin. */
// ponytail: assumes the Hobby budget; raise if EDITOR_EXPORT_PLAN_MAX_MS goes above 45 min.
export const EXPORT_POLL_CAP_MS = 60 * 60 * 1000;

export type CancelWaitPhase = "waiting" | "still_stopping" | "give_up";

export function cancelWaitPhase(elapsedMs: number): CancelWaitPhase {
  if (elapsedMs >= CANCEL_GIVE_UP_MS) return "give_up";
  return elapsedMs >= CANCEL_STILL_STOPPING_MS ? "still_stopping" : "waiting";
}

/**
 * What the dialog does with a cancel POST reply (`httpStatus` null = network error).
 * wait: cancel accepted, the status poll delivers the cancelled outcome (bounded by `CANCEL_GIVE_UP_MS`).
 * settled: already finished or failed server-side; the status poll delivers that outcome.
 * gone: no attempt exists, so nothing is running: cancelled now.
 */
export type CancelReply = "wait" | "settled" | "gone" | "not_allowed" | "error";

export function cancelReply(httpStatus: number | null, body: unknown): CancelReply {
  const b = (body && typeof body === "object" ? body : {}) as { status?: unknown; code?: unknown };
  if (httpStatus == null) return "error";
  if (httpStatus >= 200 && httpStatus < 300) {
    return b.status === "already_completed" || b.status === "already_failed" ? "settled" : "wait";
  }
  if (httpStatus === 404) return "gone";
  if (httpStatus === 409) return b.code === "CANCEL_NOT_ALLOWED" ? "not_allowed" : "settled";
  return "error";
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-export-progress self-check: ${msg}`);
}

export function editorExportProgressSelfCheck(): void {
  assert(stageFromStepKey("editor_encode") === "preparing", "encode step is preparing until progress is reported");
  assert(stageFromStepKey("storage_upload") === "saving", "upload step is saving");
  assert(stageFromStepKey(null) === "preparing", "no step is preparing");
  assert(encodePct(5e6, 10) === 50, "half way");
  assert(encodePct(10e6, 10) === 99, "never 100 before success");
  assert(encodePct(99e6, 10) === 99, "overshoot clamps");
  assert(encodePct(1, 0) === null && encodePct(NaN, 5) === null, "bad input is indeterminate");
  assert(parseExportProgress({ stage: "bogus" }) === null, "unknown stage rejected");
  assert(parseExportProgress({ stage: "encoding", progressPct: 150, updatedAt: "x" })?.progressPct === 99, "pct clamped");
  assert(parseExportProgress({ stage: "preparing", progressPct: null })?.progressPct === null, "null stays indeterminate");
  assert(monotonicPct({ stage: "encoding", pct: 40 }, { stage: "encoding", progressPct: 30, updatedAt: "" }) === 40, "monotonic");
  assert(parseExportProgress({ stage: "starting", progressPct: null })?.stage === "starting", "starting stage accepted");
  assert(!exportLooksSlow(0, 59_999) && exportLooksSlow(0, 60_000), "slow hint after 60 s unchanged");
  assert(formatElapsed(65_000) === "1:05" && formatElapsed(-5) === "0:00", "elapsed m:ss");
  assert(stageValueText("encoding", 42) === "Encoding video, 42 percent", "valuetext");
  assert(stageValueText("preparing", null) === "Preparing media", "valuetext indeterminate");
  assert(cancelWaitPhase(0) === "waiting" && cancelWaitPhase(9_999) === "waiting", "cancelling waits");
  assert(cancelWaitPhase(10_000) === "still_stopping" && cancelWaitPhase(29_999) === "still_stopping", "still stopping note");
  assert(cancelWaitPhase(30_000) === "give_up", "cancel wait gives up after 30 s");
  assert(cancelReply(200, { status: "cancelling" }) === "wait", "accepted cancel waits for the terminal status");
  assert(cancelReply(200, { status: "already_cancelling" }) === "wait", "repeat cancel waits");
  assert(cancelReply(200, { status: "already_completed" }) === "settled", "completed is terminal");
  assert(cancelReply(200, { status: "already_failed" }) === "settled", "failed is terminal");
  assert(cancelReply(404, { status: "not_found" }) === "gone", "not found is cancelled");
  assert(cancelReply(409, { code: "CANCEL_NOT_ALLOWED" }) === "not_allowed", "provider commit locks cancel");
  assert(cancelReply(409, { status: "failed" }) === "settled", "inactive job is terminal");
  assert(cancelReply(500, null) === "error" && cancelReply(null, null) === "error", "5xx and network errors clear the spinner");
}

if (require.main === module) {
  editorExportProgressSelfCheck();
  console.log("editorExportProgressSelfCheck: ok");
}
