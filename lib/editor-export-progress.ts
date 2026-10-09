// Pure stage/percentage model for the Video Editor export progress dialog (#300).
// Percentages come only from real signals; no signal means null (indeterminate).

export type ExportStage = "uploading" | "preparing" | "encoding" | "saving" | "finalizing";

export const EXPORT_STAGE_LABEL: Record<ExportStage, string> = {
  uploading: "Uploading media",
  preparing: "Preparing media",
  encoding: "Encoding video",
  saving: "Saving to your library",
  finalizing: "Finalizing",
};

const STAGES = new Set<string>(Object.keys(EXPORT_STAGE_LABEL));

/** Progress object the runner writes onto the running job step's `output`. */
export type ExportProgress = { stage: ExportStage; progressPct: number | null; updatedAt: string };

export function stageFromStepKey(stepKey: string | null | undefined): ExportStage {
  if (!stepKey) return "preparing";
  if (stepKey === "storage_upload") return "saving";
  if (/stitch|encode|ffmpeg|render/.test(stepKey)) return "encoding";
  return "preparing";
}

/** FFmpeg `-progress` out_time_us over timeline duration, clamped to 0-99 until verified. */
export function encodePct(outTimeUs: number, totalSec: number): number | null {
  if (!Number.isFinite(outTimeUs) || !Number.isFinite(totalSec) || totalSec <= 0 || outTimeUs < 0) return null;
  return Math.min(99, Math.floor((outTimeUs / 1e6 / totalSec) * 100));
}

export function uploadPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(99, Math.floor((Math.min(done, total) / total) * 100));
}

/** Throttle for runner writes: >= 1 s apart and >= 1 point change (or a stage change). */
export function shouldWriteProgress(
  last: { pct: number | null; at: number; stage: ExportStage } | null,
  next: { pct: number | null; stage: ExportStage },
  now: number,
): boolean {
  if (!last || last.stage !== next.stage) return true;
  if (next.pct === last.pct) return false;
  if (next.pct == null || last.pct == null) return true;
  return now - last.at >= 1000 && Math.abs(next.pct - last.pct) >= 1;
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

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function stageValueText(stage: ExportStage, pct: number | null): string {
  return pct == null ? EXPORT_STAGE_LABEL[stage] : `${EXPORT_STAGE_LABEL[stage]}, ${pct} percent`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-export-progress self-check: ${msg}`);
}

export function editorExportProgressSelfCheck(): void {
  assert(stageFromStepKey("rendi_stitch") === "encoding", "stitch step is encoding");
  assert(stageFromStepKey("storage_upload") === "saving", "upload step is saving");
  assert(stageFromStepKey(null) === "preparing", "no step is preparing");
  assert(encodePct(5e6, 10) === 50, "half way");
  assert(encodePct(10e6, 10) === 99, "never 100 before success");
  assert(encodePct(99e6, 10) === 99, "overshoot clamps");
  assert(encodePct(1, 0) === null && encodePct(NaN, 5) === null, "bad input is indeterminate");
  assert(uploadPct(2, 5) === 40 && uploadPct(5, 5) === 99 && uploadPct(0, 0) === null, "upload files fraction");
  const t = { pct: 10, at: 0, stage: "encoding" as const };
  assert(!shouldWriteProgress(t, { pct: 11, stage: "encoding" }, 500), "throttled under 1s");
  assert(shouldWriteProgress(t, { pct: 11, stage: "encoding" }, 1000), "writes after 1s");
  assert(!shouldWriteProgress(t, { pct: 10, stage: "encoding" }, 5000), "no write when unchanged");
  assert(shouldWriteProgress(t, { pct: null, stage: "saving" }, 10), "stage change writes");
  assert(parseExportProgress({ stage: "bogus" }) === null, "unknown stage rejected");
  assert(parseExportProgress({ stage: "encoding", progressPct: 150, updatedAt: "x" })?.progressPct === 99, "pct clamped");
  assert(parseExportProgress({ stage: "preparing", progressPct: null })?.progressPct === null, "null stays indeterminate");
  assert(monotonicPct({ stage: "encoding", pct: 40 }, { stage: "encoding", progressPct: 30, updatedAt: "" }) === 40, "monotonic");
  assert(formatElapsed(65_000) === "1:05" && formatElapsed(-5) === "0:00", "elapsed m:ss");
  assert(stageValueText("encoding", 42) === "Encoding video, 42 percent", "valuetext");
  assert(stageValueText("preparing", null) === "Preparing media", "valuetext indeterminate");
}

if (require.main === module) {
  editorExportProgressSelfCheck();
  console.log("editorExportProgressSelfCheck: ok");
}
