import "server-only";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import { supabaseServer } from "@/lib/supabase-server";
import { signStoragePathForPipeline } from "@/lib/storage-signed-url";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
} from "@/lib/storage-buckets";
import { createJobStep, finishJobStep, failJobStep, reportJobStepProgress } from "@/lib/job-steps-db";
import { encodePct, type ExportStage } from "@/lib/editor-export-progress";
import { finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { markAssetReady, markAssetFailed } from "@/lib/assets-db";
import { insertUserCreation } from "@/lib/creations-db";
import { CREATION_TOOLS } from "@/lib/creations";
import { recordUsageEvent } from "@/lib/usage-events-db";
import {
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { LOCK_TTL_MS } from "@/lib/generation-idempotency-pure";
import { generationErrorLogSafe } from "@/lib/error-log-safe";
import { probeAudioSources } from "@/lib/editor-audio-probe";
import { FFMPEG_BIN, FONT_FILE, WORK, ffmpegHasCapabilities, installPinnedTools } from "@/lib/editor-export-pin";
import {
  audibleLayerUrls,
  buildEditorFfmpegGraph,
  localizeFfmpegArgs,
} from "@/lib/editor-render";
import type { EditorDocument } from "@/lib/editor-document";
import { EXPORT_FORMAT_SPEC, exportOutputFilename, sanitizeExportTitle, type EditorExportSettings } from "@/lib/editor-export-settings";
import {
  classifyEditorExportFailure,
  classifySandboxCreateError,
  EditorExportPhaseTimeout,
  editorExportErrorJson,
  editorExportTimeoutMs,
  editorExportVcpus,
  nextEncodeStall,
  signedUploadArgs,
  withPhaseTimeout,
  type EditorExportErrorCode,
  type EncodeStall,
} from "@/lib/editor-export-pure";

/** Serializable workflow input. Storage paths only: signed URLs are minted inside the steps. */
export type EditorExportParams = {
  profileId: string;
  userId: string;
  jobId: string | null;
  generationRequestId: string;
  videoAssetId: string | null;
  document: EditorDocument;
  settings: EditorExportSettings;
  /** Owner-validated storage path per media key (clip id, creationId, or storagePath). */
  mediaPaths: Record<string, string>;
  exportUploadPaths: string[];
  title: string;
};

export type CommandStage = "encode" | "upload";
export type PollResult =
  | { state: "running"; stall: EncodeStall | null }
  | { state: "done" }
  | { state: "cancelled" }
  | { state: "failed"; code: EditorExportErrorCode };

export type EncodeStart =
  | { ok: true; sandboxName: string; cmdId: string; durationSec: number; width: number; height: number }
  | { ok: false; code: EditorExportErrorCode }
  | { ok: false; cancelled: true };

/** Sandbox lifetime = the export's time budget: 40 min default, clamped to the plan max (45 min Hobby). */
export const EDITOR_EXPORT_TIMEOUT_MS = editorExportTimeoutMs(process.env);

const outFile = (p: EditorExportParams) => `${WORK}/${exportOutputFilename(p.settings.format)}`;
const PROGRESS_FILE = `${WORK}/progress.txt`;

const requiredEncoders = (s: EditorExportSettings) => {
  const f = EXPORT_FORMAT_SPEC[s.format];
  return [f.videoCodec, f.audioCodec];
};

const sandboxName = (p: Pick<EditorExportParams, "jobId" | "generationRequestId">) =>
  `editor-export-${(p.jobId ?? p.generationRequestId).replace(/[^a-zA-Z0-9-]/g, "")}`;

const logSafe = (label: string, e: unknown) =>
  console.warn(`[editor-export] ${label}:`, generationErrorLogSafe(e));

type AttemptState = "live" | "cancelled" | "settled" | "superseded";

/**
 * Whether this run still owns its attempt. cancelled: Cancel was requested (the cancel route may already have
 * settled the row). settled: the row was closed elsewhere. superseded: a retry took the key over (new job).
 * Anything but live stops the run; only live and cancelled runs write the idempotency row.
 */
async function attemptState(p: Pick<EditorExportParams, "profileId" | "generationRequestId" | "jobId">): Promise<AttemptState> {
  const { data, error } = await supabaseServer
    .from("generation_requests")
    .select("status, cancel_requested, job_id")
    .eq("id", p.generationRequestId)
    .eq("profile_id", p.profileId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { status?: string; cancel_requested?: boolean; job_id?: string | null } | null;
  if (!row || (p.jobId && row.job_id !== p.jobId)) return "superseded";
  if (row.cancel_requested) return "cancelled";
  return row.status === "started" ? "live" : "settled";
}

async function run(sandbox: Sandbox, cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const r = await sandbox.runCommand(cmd, args);
  return { ok: r.exitCode === 0, stdout: await r.stdout() };
}

/**
 * Boot from the baked snapshot when `EDITOR_EXPORT_SNAPSHOT_ID` is set (no download at export time); otherwise
 * install the pinned, SHA-256-verified build (local dev, previews). Either way the capability check runs and
 * every failure is closed: FFmpeg is never executed unverified.
 */
async function createSandbox(p: EditorExportParams): Promise<Sandbox> {
  const snapshotId = process.env.EDITOR_EXPORT_SNAPSHOT_ID;
  const base = { name: sandboxName(p), timeout: EDITOR_EXPORT_TIMEOUT_MS, resources: { vcpus: editorExportVcpus(p.settings, process.env) }, persistent: false };
  if (!snapshotId) return Sandbox.create(base);
  const snap = await Snapshot.get({ snapshotId });
  if (snap.status !== "created") throw new Error("snapshot not usable");
  return Sandbox.create({ ...base, source: { type: "snapshot", snapshotId } });
}

async function prepareSandbox(sandbox: Sandbox, needsFont: boolean, encoders: string[]): Promise<boolean> {
  const exec = (cmd: string, args: string[]) => run(sandbox, cmd, args);
  if (!process.env.EDITOR_EXPORT_SNAPSHOT_ID && !(await installPinnedTools(exec, needsFont))) return false;
  return ffmpegHasCapabilities(exec, encoders, needsFont);
}

export async function beginStepCore(p: EditorExportParams, key: string, name: string): Promise<string | null> {
  if (!p.jobId) return null;
  try {
    const step = await createJobStep({ jobId: p.jobId, profileId: p.profileId, stepKey: key, stepName: name, status: "running" });
    return step.id;
  } catch (e) {
    logSafe("createStep failed", e);
    return null;
  }
}

export async function endStepCore(p: EditorExportParams, stepId: string | null, output?: Record<string, unknown>) {
  if (!stepId) return;
  await finishJobStep(p.profileId, stepId, output).catch((e) => logSafe("finishStep failed", e));
}

/**
 * Sign inputs, build the graph, boot the sandbox, and start FFmpeg detached. Each phase reports its stage and has
 * its own limit (`EDITOR_EXPORT_PHASE_TIMEOUT_MS`), so a hung phase ends the export instead of sitting on
 * "Preparing media".
 */
export async function startEncodeCore(p: EditorExportParams, stepId: string | null): Promise<EncodeStart> {
  let sandbox: Sandbox | null = null;
  // A job without a step means beginStep failed: the dialog cannot show progress for this export.
  if (!stepId && p.jobId) logSafe("progress reporting disabled", new Error("no running step for this export"));
  try {
    await reportProgressCore(p, stepId, "preparing", null);
    const urls: Record<string, string> = {};
    await withPhaseTimeout(
      "sign",
      (async () => {
        for (const [key, path] of Object.entries(p.mediaPaths)) {
          urls[key] = await signStoragePathForPipeline(path, p.userId);
        }
      })()
    );
    const audioUrls = await withPhaseTimeout("probe", probeAudioSources(audibleLayerUrls(p.document, urls)));
    const graph = buildEditorFfmpegGraph(p.document, urls, audioUrls, p.settings);
    const hasFont = Boolean(graph.inputFiles.in_font);

    // Cancel is honored between phases, so it never waits for a full sandbox boot.
    if ((await attemptState(p)) !== "live") return { ok: false, cancelled: true };
    await reportProgressCore(p, stepId, "starting", null);
    const creating = createSandbox(p);
    try {
      sandbox = await withPhaseTimeout("create", creating);
    } catch (e) {
      logSafe("sandbox create failed", e);
      if (e instanceof EditorExportPhaseTimeout) {
        // ponytail: best effort, only while this function instance lives; the sandbox timeout is the backstop.
        void creating.then((late) => late.stop()).catch(() => undefined);
        return { ok: false, code: "EDITOR_EXPORT_START_TIMEOUT" };
      }
      return { ok: false, code: classifySandboxCreateError(e) };
    }
    if (!(await withPhaseTimeout("prepare", prepareSandbox(sandbox, hasFont, requiredEncoders(p.settings))))) {
      throw new Error("sandbox preparation failed");
    }
    if ((await attemptState(p)) !== "live") {
      await sandbox.stop().catch(() => undefined);
      return { ok: false, cancelled: true };
    }

    const values: Record<string, string> = { out_v: outFile(p), in_font: FONT_FILE };
    for (const [alias, url] of Object.entries(graph.inputFiles)) {
      if (alias !== "in_font") values[alias] = url;
    }
    const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", PROGRESS_FILE, ...localizeFfmpegArgs(graph.args, values)];
    const cmd = await withPhaseTimeout("ffmpegStart", sandbox.runCommand({ cmd: FFMPEG_BIN, args, detached: true }));
    // FFmpeg is running; the percentage stays indeterminate until `out_time_us` is readable.
    await reportProgressCore(p, stepId, "encoding", null);
    return { ok: true, sandboxName: sandbox.name, cmdId: cmd.cmdId, durationSec: graph.durationSec, width: graph.width, height: graph.height };
  } catch (e) {
    logSafe("encode start failed", e);
    await sandbox?.stop().catch(() => undefined);
    return { ok: false, code: e instanceof EditorExportPhaseTimeout ? "EDITOR_EXPORT_START_TIMEOUT" : classifyEditorExportFailure({ stage: "setup" }) };
  }
}

async function touchLiveness(p: EditorExportParams) {
  const now = new Date();
  await Promise.all([
    supabaseServer
      .from("generation_requests")
      .update({ locked_until: new Date(now.getTime() + LOCK_TTL_MS).toISOString() })
      .eq("id", p.generationRequestId)
      .eq("profile_id", p.profileId)
      .eq("status", "started"),
    p.jobId
      ? supabaseServer.from("jobs").update({ updated_at: now.toISOString() }).eq("id", p.jobId).eq("profile_id", p.profileId)
      : Promise.resolve(),
  ]).catch((e) => logSafe("liveness touch failed", e));
}

/** Live status for the progress dialog: {stage, progressPct, updatedAt} on the running step output. */
export async function reportProgressCore(p: EditorExportParams, stepId: string | null, stage: ExportStage, progressPct: number | null) {
  if (!stepId) return;
  await reportJobStepProgress(p.profileId, stepId, { stage, progressPct, updatedAt: new Date().toISOString() }).catch((e) =>
    logSafe("progress report failed", e)
  );
}

/**
 * One non-blocking check of a detached sandbox command; honors Cancel by stopping the sandbox.
 * Encode: `stall` carries the last `out_time_us` between polls; no advance for `EDITOR_EXPORT_STALL_MS` fails it.
 */
export async function pollCommandCore(
  p: EditorExportParams,
  name: string,
  cmdId: string,
  stage: CommandStage,
  startedAtMs: number,
  stepId: string | null,
  durationSec: number,
  stall: EncodeStall | null = null
): Promise<PollResult> {
  if ((await attemptState(p)) !== "live") {
    await stopSandboxCore(name);
    return { state: "cancelled" };
  }
  await touchLiveness(p);
  const timedOut = Date.now() - startedAtMs > EDITOR_EXPORT_TIMEOUT_MS;
  try {
    const sandbox = await Sandbox.get({ name });
    const cmd = await sandbox.getCommand(cmdId);
    if (cmd.exitCode === null) {
      if (timedOut) return { state: "failed", code: "EDITOR_EXPORT_TIMEOUT" };
      if (stage !== "encode") return { state: "running", stall: null };
      // FFmpeg `-progress` appends blocks of key=value; the last out_time_us is the real encoded time.
      const tail = await run(sandbox, "tail", ["-n", "40", PROGRESS_FILE]).catch(() => null);
      const us = tail ? [...tail.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1] : undefined;
      const next = nextEncodeStall(stall, us ? Number(us) : null, Date.now());
      if (next.stalled) {
        await stopSandboxCore(name);
        return { state: "failed", code: "EDITOR_EXPORT_STALLED" };
      }
      await reportProgressCore(p, stepId, "encoding", us ? encodePct(Number(us), durationSec) : null);
      return { state: "running", stall: next.stall };
    }
    if (cmd.exitCode === 0) return { state: "done" };
    const stderr = stage === "encode" ? await cmd.stderr().catch(() => "") : "";
    return { state: "failed", code: classifyEditorExportFailure({ stage, exitCode: cmd.exitCode, stderr }) };
  } catch (e) {
    // Past the time budget the sandbox is gone: a timeout. Otherwise a transient API error must not
    // kill a healthy encode, so rethrow and let Workflow retry this step.
    logSafe("poll failed", e);
    if (timedOut) return { state: "failed", code: "EDITOR_EXPORT_TIMEOUT" };
    throw e;
  }
}

/** Upload the encoded file straight from the sandbox to private Storage (detached). */
export async function startUploadCore(
  p: EditorExportParams,
  name: string
): Promise<{ ok: true; cmdId: string; storagePath: string } | { ok: false; code: EditorExportErrorCode }> {
  try {
    const storagePath = videosGeneratedVideoPath(p.userId, "editor", `video_${Date.now()}.${EXPORT_FORMAT_SPEC[p.settings.format].ext}`);
    const { data, error } = await supabaseServer.storage.from(STORAGE_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data) throw new Error("signed upload url failed");
    const sandbox = await Sandbox.get({ name });
    const cmd = await sandbox.runCommand({
      cmd: "curl",
      args: signedUploadArgs({ url: data.signedUrl, file: outFile(p), contentType: EXPORT_FORMAT_SPEC[p.settings.format].mime, cacheControl: MEDIA_CACHE_CONTROL }),
      detached: true,
    });
    return { ok: true, cmdId: cmd.cmdId, storagePath };
  } catch (e) {
    logSafe("upload start failed", e);
    return { ok: false, code: "EDITOR_EXPORT_UPLOAD_FAILED" };
  }
}

export async function encodedFileSizeCore(p: EditorExportParams, name: string): Promise<number> {
  const sandbox = await Sandbox.get({ name });
  const out = await run(sandbox, "stat", ["-c", "%s", outFile(p)]);
  return Number.parseInt(out.stdout.trim(), 10) || 0;
}

export async function stopSandboxCore(name: string | null): Promise<void> {
  if (!name) return;
  try {
    await (await Sandbox.get({ name })).stop();
  } catch (e) {
    logSafe("sandbox stop failed", e);
  }
}

export async function removeExportUploadsCore(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove(paths).catch((e: unknown) => ({ error: e }));
  if (error) logSafe("export upload cleanup failed", error);
}

/** Success: creation row, asset, job, usage, and the idempotent response the client polls for. */
export async function finalizeSuccessCore(
  p: EditorExportParams,
  stepId: string | null,
  r: { storagePath: string; fileSizeBytes: number; durationSec: number; width: number; height: number }
): Promise<void> {
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      logSafe(`${label} failed`, e);
      return null;
    }
  };
  // Commit fence: lock Cancel (requestCancel needs cancel_allowed=true) while this run still owns a live row.
  // A cancel or retry that won makes this throw, so the workflow settles as cancelled and removes the upload.
  let lock = supabaseServer
    .from("generation_requests")
    .update({ cancel_allowed: false })
    .eq("id", p.generationRequestId)
    .eq("profile_id", p.profileId)
    .eq("status", "started")
    .eq("cancel_requested", false);
  if (p.jobId) lock = lock.eq("job_id", p.jobId);
  const { data: locked, error: lockError } = await lock.select("id").maybeSingle();
  if (lockError || !locked) throw new Error("export cancelled or cancel lock failed");
  await reportProgressCore(p, stepId, "finalizing", null);
  await endStepCore(p, stepId, { storagePath: r.storagePath });

  // Not swallowed: without a library row the export would "succeed" yet be invisible.
  const historyItem = await insertUserCreation({
      userId: p.userId,
      tool: "video_editor",
      mediaType: "video",
      mediaUrl: r.storagePath,
      storagePath: r.storagePath,
      title: sanitizeExportTitle(p.title),
      metadata: {
        aspect: p.document.aspect,
        resolution: p.settings.resolution,
        quality: p.settings.quality,
        fps: p.settings.fps,
        format: p.settings.format,
        durationSec: r.durationSec,
        clipCount: p.document.sequence.length,
        overlayCount: p.document.overlays.length,
      },
      jobId: p.jobId,
  });
  if (p.videoAssetId) {
    await safe("markAssetReady", () =>
      markAssetReady(p.profileId, p.videoAssetId!, {
        storagePath: r.storagePath,
        mimeType: EXPORT_FORMAT_SPEC[p.settings.format].mime,
        durationSec: r.durationSec,
        width: r.width,
        height: r.height,
        fileSizeBytes: r.fileSizeBytes,
        costCredits: 0,
      })
    );
  }
  if (p.jobId) {
    await safe("finishJob", () =>
      finishJob(p.profileId, p.jobId!, { output: { storagePath: r.storagePath, creationId: historyItem?.id ?? null }, costCredits: 0 })
    );
  }
  await safe("usage", () =>
    recordUsageEvent({
      profileId: p.profileId,
      jobId: p.jobId,
      assetId: p.videoAssetId,
      tool: "editor",
      provider: "vercel-sandbox",
      model: "ffmpeg",
      creditsCharged: 0,
      units: r.durationSec,
      unitType: "second",
      metadata: { durationSec: r.durationSec, aspect: p.document.aspect },
    })
  );
  await finishGenerationRequestSuccess({
    id: p.generationRequestId,
    profileId: p.profileId,
    jobId: p.jobId,
    responseJson: {
      ok: true,
      storagePath: r.storagePath,
      creation: historyItem,
      durationSec: r.durationSec,
      credits: 0,
      toolLabel: CREATION_TOOLS.video_editor.label,
    },
  });
}

/**
 * Failure or cancel: close step, asset, job, and the idempotency row with a sanitized reason.
 * Once Cancel was requested the attempt always settles as cancelled, so the workflow never overwrites the
 * row the cancel route already settled; a superseded run leaves the retry's row alone.
 */
export async function finalizeFailureCore(
  p: Pick<EditorExportParams, "profileId" | "generationRequestId" | "jobId" | "videoAssetId">,
  stepId: string | null,
  requested: { cancelled: true } | { cancelled: false; code: EditorExportErrorCode }
): Promise<void> {
  const state = await attemptState(p).catch(() => "live" as const);
  const outcome = state === "cancelled" ? ({ cancelled: true } as const) : requested;
  const errJson = outcome.cancelled
    ? { message: "Export cancelled.", code: "GENERATION_CANCELLED" }
    : editorExportErrorJson(outcome.code);
  if (!outcome.cancelled) console.error(`[editor-export] failed: ${outcome.code}`);
  const safe = (label: string, fn: () => Promise<unknown>) => fn().catch((e) => logSafe(`${label} failed`, e));
  if (stepId) await safe("failStep", () => failJobStep(p.profileId, stepId, errJson));
  if (p.videoAssetId) await safe("failAsset", () => markAssetFailed(p.profileId, p.videoAssetId!, errJson));
  if (p.jobId) {
    await safe("failJob", () => (outcome.cancelled ? cancelJob(p.profileId, p.jobId!, errJson) : failJob(p.profileId, p.jobId!, errJson)));
  }
  if (state === "superseded" || state === "settled") return;
  await safe("idemFailure", () =>
    finishGenerationRequestFailure({ id: p.generationRequestId, profileId: p.profileId, jobId: p.jobId, errorJson: errJson })
  );
}

/**
 * Cancel accepted by `/api/generations/cancel`: settle the attempt now instead of waiting for the workflow to
 * observe the flag (it may be stuck booting the runner), then stop the sandbox by its deterministic name.
 * Idempotent and owner-scoped; 0 credits, so nothing to refund.
 */
export async function settleCancelledExportCore(
  t: Pick<EditorExportParams, "profileId" | "generationRequestId" | "jobId">
): Promise<void> {
  let stepId: string | null = null;
  let videoAssetId: string | null = null;
  if (t.jobId) {
    const [step, asset] = await Promise.all([
      supabaseServer
        .from("job_steps")
        .select("id")
        .eq("job_id", t.jobId)
        .eq("profile_id", t.profileId)
        .eq("status", "running")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseServer
        .from("assets")
        .select("id")
        .eq("job_id", t.jobId)
        .eq("profile_id", t.profileId)
        .eq("status", "processing")
        .limit(1)
        .maybeSingle(),
    ]);
    stepId = (step.data as { id?: string } | null)?.id ?? null;
    videoAssetId = (asset.data as { id?: string } | null)?.id ?? null;
  }
  await finalizeFailureCore({ ...t, videoAssetId }, stepId, { cancelled: true });
  await stopSandboxCore(sandboxName(t));
}
