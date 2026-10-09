import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { supabaseServer } from "@/lib/supabase-server";
import { signStoragePathForPipeline } from "@/lib/storage-signed-url";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
} from "@/lib/storage-buckets";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { markAssetReady, markAssetFailed } from "@/lib/assets-db";
import { insertUserCreation } from "@/lib/creations-db";
import { CREATION_TOOLS } from "@/lib/creations";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { isCancelRequested } from "@/lib/generation-cancel";
import {
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { LOCK_TTL_MS } from "@/lib/generation-idempotency-pure";
import { generationErrorLogSafe } from "@/lib/error-log-safe";
import { probeAudioSources } from "@/lib/editor-audio-probe";
import { EDITOR_FONT_URL } from "@/lib/editor-font";
import {
  audibleLayerUrls,
  buildEditorFfmpegGraph,
  localizeFfmpegArgs,
} from "@/lib/editor-render";
import type { EditorDocument } from "@/lib/editor-document";
import { EXPORT_FORMAT_SPEC, sanitizeExportTitle, type EditorExportSettings } from "@/lib/editor-export-settings";
import {
  classifyEditorExportFailure,
  editorExportErrorJson,
  editorExportVcpus,
  signedUploadArgs,
  type EditorExportErrorCode,
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
  | { state: "running" }
  | { state: "done" }
  | { state: "cancelled" }
  | { state: "failed"; code: EditorExportErrorCode };

export type EncodeStart =
  | { ok: true; sandboxName: string; cmdId: string; durationSec: number; width: number; height: number }
  | { ok: false; code: EditorExportErrorCode };

/** Sandbox lifetime = the export's time budget. Plan max: 45 min Hobby, 5 h Pro/Enterprise. */
export const EDITOR_EXPORT_TIMEOUT_MS = Number(process.env.EDITOR_EXPORT_TIMEOUT_MS) || 3 * 60 * 60 * 1000;

const WORK = "export";
const outFile = (p: EditorExportParams) => `${WORK}/editor_export.${EXPORT_FORMAT_SPEC[p.settings.format].ext}`;
const FONT_FILE = `${WORK}/Poppins.ttf`;
const FFMPEG = `${WORK}/ff/ffmpeg`;
// ponytail: third-party static build fetched per run; host it ourselves or bake a Sandbox snapshot if this becomes flaky.
const FFMPEG_URL =
  process.env.EDITOR_EXPORT_FFMPEG_URL ||
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

const requiredEncoders = (s: EditorExportSettings) => {
  const f = EXPORT_FORMAT_SPEC[s.format];
  return [f.videoCodec, f.audioCodec];
};

const sandboxName = (p: EditorExportParams) =>
  `editor-export-${(p.jobId ?? p.generationRequestId).replace(/[^a-zA-Z0-9-]/g, "")}`;

const logSafe = (label: string, e: unknown) =>
  console.warn(`[editor-export] ${label}:`, generationErrorLogSafe(e));

async function run(sandbox: Sandbox, cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const r = await sandbox.runCommand(cmd, args);
  return { ok: r.exitCode === 0, stdout: await r.stdout() };
}

/** Download FFmpeg + font into the sandbox and assert the build has what the graph needs. */
async function prepareSandbox(sandbox: Sandbox, needsFont: boolean, encoders: string[]): Promise<boolean> {
  await sandbox.mkDir(WORK);
  await sandbox.mkDir(`${WORK}/ff`);
  if (!(await run(sandbox, "curl", ["-fsSL", "--retry", "3", "-o", `${WORK}/ff.tar.xz`, FFMPEG_URL])).ok) return false;
  if (!(await run(sandbox, "tar", ["-xJf", `${WORK}/ff.tar.xz`, "-C", `${WORK}/ff`, "--strip-components=1"])).ok) return false;
  const enc = await run(sandbox, FFMPEG, ["-hide_banner", "-encoders"]);
  const filt = await run(sandbox, FFMPEG, ["-hide_banner", "-filters"]);
  if (!enc.ok || !filt.ok || !/\bdrawtext\b/.test(filt.stdout)) return false;
  // Whole-word match so e.g. "libvpx-vp9" is not satisfied by "libvpx".
  if (!encoders.every((e) => new RegExp(`\\s${e}\\s`).test(enc.stdout))) return false;
  if (needsFont && !(await run(sandbox, "curl", ["-fsSL", "--retry", "3", "-o", FONT_FILE, EDITOR_FONT_URL])).ok) {
    return false;
  }
  return true;
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

/** Sign inputs, build the graph, boot the sandbox, and start FFmpeg detached. */
export async function startEncodeCore(p: EditorExportParams): Promise<EncodeStart> {
  let sandbox: Sandbox | null = null;
  try {
    const urls: Record<string, string> = {};
    for (const [key, path] of Object.entries(p.mediaPaths)) {
      urls[key] = await signStoragePathForPipeline(path, p.userId);
    }
    const audioUrls = await probeAudioSources(audibleLayerUrls(p.document, urls));
    const graph = buildEditorFfmpegGraph(p.document, urls, audioUrls, p.settings);
    const hasFont = Boolean(graph.inputFiles.in_font);

    sandbox = await Sandbox.create({
      name: sandboxName(p),
      timeout: EDITOR_EXPORT_TIMEOUT_MS,
      resources: { vcpus: editorExportVcpus(p.settings) },
      persistent: false,
    });
    if (!(await prepareSandbox(sandbox, hasFont, requiredEncoders(p.settings)))) throw new Error("sandbox preparation failed");

    const values: Record<string, string> = { out_v: outFile(p), in_font: FONT_FILE };
    for (const [alias, url] of Object.entries(graph.inputFiles)) {
      if (alias !== "in_font") values[alias] = url;
    }
    const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...localizeFfmpegArgs(graph.args, values)];
    const cmd = await sandbox.runCommand({ cmd: FFMPEG, args, detached: true });
    return { ok: true, sandboxName: sandbox.name, cmdId: cmd.cmdId, durationSec: graph.durationSec, width: graph.width, height: graph.height };
  } catch (e) {
    logSafe("encode start failed", e);
    await sandbox?.stop().catch(() => undefined);
    return { ok: false, code: classifyEditorExportFailure({ stage: "setup" }) };
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

/** One non-blocking check of a detached sandbox command; honors Cancel by stopping the sandbox. */
export async function pollCommandCore(
  p: EditorExportParams,
  name: string,
  cmdId: string,
  stage: CommandStage,
  startedAtMs: number
): Promise<PollResult> {
  if (await isCancelRequested(p.profileId, p.generationRequestId)) {
    await stopSandboxCore(name);
    return { state: "cancelled" };
  }
  await touchLiveness(p);
  const timedOut = Date.now() - startedAtMs > EDITOR_EXPORT_TIMEOUT_MS;
  try {
    const sandbox = await Sandbox.get({ name });
    const cmd = await sandbox.getCommand(cmdId);
    if (cmd.exitCode === null) {
      return timedOut ? { state: "failed", code: "EDITOR_EXPORT_TIMEOUT" } : { state: "running" };
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

/** Failure or cancel: close step, asset, job, and the idempotency row with a sanitized reason. */
export async function finalizeFailureCore(
  p: EditorExportParams,
  stepId: string | null,
  outcome: { cancelled: true } | { cancelled: false; code: EditorExportErrorCode }
): Promise<void> {
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
  await safe("idemFailure", () =>
    finishGenerationRequestFailure({ id: p.generationRequestId, profileId: p.profileId, jobId: p.jobId, errorJson: errJson })
  );
}
