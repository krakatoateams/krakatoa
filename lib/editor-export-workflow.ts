import { sleep } from "workflow";
import type { EditorExportErrorCode } from "@/lib/editor-export-pure";
import type { CommandStage, EditorExportParams, PollResult } from "@/lib/editor-export-core";

const POLL_MS = 10_000;
// Upper bound on poll iterations (budget / interval); the sandbox lifetime enforces the real limit.
const MAX_POLLS = 4000;

/**
 * Durable Editor export: FFmpeg runs in a Vercel Sandbox, detached, and this
 * workflow polls it in short steps, so no step is bound by the 300s function limit.
 * 0 credits, so there is no spend/refund path. Never calls Rendi.
 */
export async function editorExportWorkflow(params: EditorExportParams): Promise<void> {
  "use workflow";

  let stepId: string | null = null;
  let name: string | null = null;
  try {
    stepId = await beginStep(params, "editor_encode", "Encode timeline in-system (FFmpeg)");
    const start = await startEncodeStep(params);
    if (!start.ok) return await failStep(params, stepId, { cancelled: false, code: start.code });
    name = start.sandboxName;

    const encoded = await waitFor(params, name, start.cmdId, "encode");
    if (encoded.state !== "done") return await settleNotDone(params, stepId, encoded);
    await endStep(params, stepId, { durationSec: start.durationSec });

    stepId = await beginStep(params, "storage_upload", "Save export to Supabase");
    const upload = await startUploadStep(params, name);
    if (!upload.ok) return await failStep(params, stepId, { cancelled: false, code: upload.code });
    const uploaded = await waitFor(params, name, upload.cmdId, "upload");
    if (uploaded.state !== "done") return await settleNotDone(params, stepId, uploaded);

    await finalizeStep(params, stepId, name, upload.storagePath, start);
  } catch (error) {
    console.error("[editor-export workflow] unexpected failure", error instanceof Error ? error.name : "unknown");
    await failStep(params, stepId, { cancelled: false, code: "EDITOR_EXPORT_ENCODER_FAILED" });
  } finally {
    await cleanupStep(params, name);
  }
}

async function waitFor(params: EditorExportParams, name: string, cmdId: string, stage: CommandStage): Promise<PollResult> {
  const startedAtMs = await nowStep();
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    const r = await pollStep(params, name, cmdId, stage, startedAtMs);
    if (r.state !== "running") return r;
  }
  return { state: "failed", code: "EDITOR_EXPORT_TIMEOUT" };
}

async function settleNotDone(params: EditorExportParams, stepId: string | null, r: PollResult) {
  if (r.state === "cancelled") return failStep(params, stepId, { cancelled: true });
  const code: EditorExportErrorCode = r.state === "failed" ? r.code : "EDITOR_EXPORT_ENCODER_FAILED";
  return failStep(params, stepId, { cancelled: false, code });
}

async function nowStep(): Promise<number> {
  "use step";
  return Date.now();
}

async function beginStep(params: EditorExportParams, key: string, label: string) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  return core.beginStepCore(params, key, label);
}

async function endStep(params: EditorExportParams, stepId: string | null, output?: Record<string, unknown>) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  await core.endStepCore(params, stepId, output);
}

async function startEncodeStep(params: EditorExportParams) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  return core.startEncodeCore(params);
}

async function pollStep(params: EditorExportParams, name: string, cmdId: string, stage: CommandStage, startedAtMs: number) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  return core.pollCommandCore(params, name, cmdId, stage, startedAtMs);
}

async function startUploadStep(params: EditorExportParams, name: string) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  return core.startUploadCore(params, name);
}

async function finalizeStep(
  params: EditorExportParams,
  stepId: string | null,
  name: string,
  storagePath: string,
  meta: { durationSec: number; width: number; height: number }
) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  const fileSizeBytes = await core.encodedFileSizeCore(name);
  await core.finalizeSuccessCore(params, stepId, { storagePath, fileSizeBytes, ...meta });
}

async function failStep(
  params: EditorExportParams,
  stepId: string | null,
  outcome: { cancelled: true } | { cancelled: false; code: EditorExportErrorCode }
) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  await core.finalizeFailureCore(params, stepId, outcome);
}

async function cleanupStep(params: EditorExportParams, name: string | null) {
  "use step";
  const core = await import("@/lib/editor-export-core");
  await core.stopSandboxCore(name);
  await core.removeExportUploadsCore(params.exportUploadPaths);
}
