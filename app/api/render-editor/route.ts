import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  attachGenerationRequestJob,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { assertNotCancelled } from "@/lib/generation-cancel";
import { markProviderCommitted, isRefundableUserCancellation } from "@/lib/generation-commit";
import { isCancellation } from "@/lib/replicate-server";
import {
  assertPathOwnedByUser,
  signStoragePathForPipeline,
  signStoragePathForUser,
} from "@/lib/storage-signed-url";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
} from "@/lib/storage-buckets";
import { supabaseServer } from "@/lib/supabase-server";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";
import { insertUserCreation, getUserCreationForUser } from "@/lib/creations-db";
import { CREATION_TOOLS } from "@/lib/creations";
import {
  collectEditorMediaRefs,
  parseEditorDocument,
  sequenceDurationSec,
  validateEditorExport,
} from "@/lib/editor-document";
import { runEditorRender } from "@/lib/editor-render";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const JOB_TYPE = "video_editor";

/**
 * POST /api/render-editor — stitch the Editor timeline via Rendi FFmpeg
 * and write the MP4 into My Library.
 */
export async function POST(req: Request) {
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let generationRequestId: string | null = null;
  let videoAssetId: string | null = null;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[editor obs] ${label} failed:`, e);
      return null;
    }
  };

  try {
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[render-editor] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    try {
      await assertToolEnabled("editor");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[render-editor] tool guard unexpected error (failing open):", e);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const document = parseEditorDocument(b.document);
    if (!document) {
      return NextResponse.json({ error: "That timeline could not be exported." }, { status: 400 });
    }
    const invalid = validateEditorExport(document);
    if (invalid) {
      return NextResponse.json({ error: invalid.message, code: invalid.code }, { status: 400 });
    }

    const refs = collectEditorMediaRefs(document);
    const urls: Record<string, string> = {};

    for (const creationId of refs.creationIds) {
      const item = await getUserCreationForUser(userId!, creationId);
      if (!item) {
        return NextResponse.json(
          { error: "One of the clips is missing from your library." },
          { status: 400 }
        );
      }
      const path = item.storagePath?.trim();
      if (!path) {
        return NextResponse.json(
          { error: "A library clip is missing its storage path." },
          { status: 400 }
        );
      }
      await assertPathOwnedByUser(path, userId!);
      urls[creationId] = await signStoragePathForPipeline(path, userId!);
    }

    for (const storagePath of refs.storagePaths) {
      await assertPathOwnedByUser(storagePath, userId!);
      urls[storagePath] = await signStoragePathForPipeline(storagePath, userId!);
    }

    const durationSec = sequenceDurationSec(document);

    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      route: "render_editor",
      aspect: document.aspect,
      durationSec,
      sequence: document.sequence.map((c) => ({
        id: c.id,
        creationId: c.creationId,
        storagePath: c.storagePath,
        startSec: c.startSec,
        endSec: c.endSec,
        inSec: c.inSec,
        sourceDurationSec: c.sourceDurationSec,
        order: c.order,
      })),
      overlays: document.overlays.map((o) => ({
        id: o.id,
        kind: o.kind,
        startSec: o.startSec,
        endSec: o.endSec,
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
        z: o.z,
        text: o.text,
        creationId: o.creationId,
        storagePath: o.storagePath,
      })),
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "render_editor",
      toolKey: "editor",
      requestHash,
    });
    if (begin.action === "conflict") {
      return NextResponse.json(
        {
          error: "This idempotency key was already used with a different request.",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 }
      );
    }
    if (begin.action === "in_progress") {
      return NextResponse.json(
        { error: "Export already in progress, please wait.", code: "GENERATION_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (begin.action === "replay") {
      return NextResponse.json(begin.response);
    }
    if (begin.action === "recoverable") {
      return NextResponse.json(
        {
          recoverable: true,
          jobId: begin.jobId,
          error: "Export paused for recovery.",
          code: "PIPELINE_RECOVERABLE",
          refunded: false,
        },
        { status: 503 }
      );
    }
    generationRequestId = begin.id;

    const job = await safe("createJob", () =>
      createJob({
        profileId: profileId!,
        tool: "editor",
        jobType: JOB_TYPE,
        provider: "rendi",
        model: "ffmpeg",
        input: {
          prompt: "Editor export",
          aspect: document.aspect,
          durationSec,
          clipCount: document.sequence.length,
          overlayCount: document.overlays.length,
        },
      })
    );
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, job.id));
      await safe("attachJob", () =>
        attachGenerationRequestJob({
          id: generationRequestId!,
          profileId: profileId!,
          jobId: job.id,
        })
      );
    }

    const asset = await safe("createAsset", () =>
      createProcessingAsset({
        profileId: profileId!,
        jobId: jobId ?? undefined,
        tool: "editor",
        assetType: "video",
        role: JOB_TYPE,
        provider: "rendi",
        model: "ffmpeg",
        metadata: { aspect: document.aspect, durationSec },
      })
    );
    if (asset) videoAssetId = asset.id;

    const beginStep = async (key: string, name: string) => {
      if (!jobId || !profileId) return;
      const step = await safe("createStep", () =>
        createJobStep({
          jobId: jobId!,
          profileId: profileId!,
          stepKey: key,
          stepName: name,
          status: "running",
        })
      );
      currentStepId = step?.id ?? null;
    };
    const endStep = async (output?: Record<string, unknown>) => {
      if (!currentStepId || !profileId) return;
      await safe("finishStep", () => finishJobStep(profileId!, currentStepId!, output));
      currentStepId = null;
    };

    await beginStep("rendi_stitch", "Trim, stitch, and composite via Rendi");
    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }
    const rendered = await runEditorRender(document, urls, {
      abortCheck: async () => {
        if (generationRequestId && profileId) {
          await assertNotCancelled(profileId, generationRequestId);
        }
      },
    });
    await endStep({ durationSec: rendered.durationSec });

    if (generationRequestId && profileId) {
      await markProviderCommitted({
        generationRequestId,
        profileId,
        reason: "editor_rendi",
      });
    }

    await beginStep("storage_upload", "Download export + save to Supabase");
    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }
    const videoResponse = await fetch(rendered.url);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download editor export: ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const storagePath = videosGeneratedVideoPath(userId!, "editor", `video_${Date.now()}.mp4`);
    const { error: uploadError } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, videoBuffer, {
        contentType: "video/mp4",
        cacheControl: MEDIA_CACHE_CONTROL,
        upsert: false,
      });
    if (uploadError) {
      throw new Error(`Failed to save video to storage: ${uploadError.message}`);
    }
    const { url: publicUrl } = await signStoragePathForUser(storagePath, userId!, "ui");
    await endStep({ storagePath });

    const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 80) : "Editor export";
    const historyItem = await safe("insertUserCreation", () =>
      insertUserCreation({
        userId: userId!,
        tool: "video_editor",
        mediaType: "video",
        mediaUrl: storagePath,
        storagePath,
        title,
        metadata: {
          aspect: document.aspect,
          durationSec: rendered.durationSec,
          clipCount: document.sequence.length,
          overlayCount: document.overlays.length,
        },
      })
    );

    if (videoAssetId && profileId) {
      await safe("markAssetReady", () =>
        markAssetReady(profileId!, videoAssetId!, {
          storagePath,
          mimeType: "video/mp4",
          durationSec: rendered.durationSec,
          width: rendered.width,
          height: rendered.height,
          fileSizeBytes: videoBuffer.length,
          costCredits: 0,
        })
      );
    }
    if (jobId && profileId) {
      await safe("finishJob", () =>
        finishJob(profileId!, jobId!, {
          output: { storagePath, creationId: historyItem?.id ?? null },
          costCredits: 0,
        })
      );
    }
    await safe("usage", () =>
      recordUsageEvent({
        profileId: profileId!,
        jobId: jobId ?? null,
        assetId: videoAssetId,
        tool: "editor",
        provider: "rendi",
        model: "ffmpeg",
        creditsCharged: 0,
        units: rendered.durationSec,
        unitType: "second",
        metadata: { durationSec: rendered.durationSec, aspect: document.aspect },
      })
    );

    const successResponse = {
      ok: true,
      storagePath,
      mediaUrl: publicUrl,
      creation: historyItem,
      durationSec: rendered.durationSec,
      credits: 0,
      toolLabel: CREATION_TOOLS.video_editor.label,
    };
    if (generationRequestId && profileId) {
      await safe("idemSuccess", () =>
        finishGenerationRequestSuccess({
          id: generationRequestId!,
          profileId: profileId!,
          jobId: jobId ?? null,
          responseJson: successResponse,
        })
      );
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    if (cancelled) console.log("[render-editor] Cancelled by user.");
    else console.error("[render-editor] Error:", error);
    const message = cancelled
      ? "Export cancelled."
      : error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");
    const errJson = cancelled
      ? { message, code: "GENERATION_CANCELLED" }
      : { message };

    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
    }
    if (videoAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, videoAssetId!, errJson));
    }
    if (jobId && profileId) {
      if (cancelled) {
        await safe("cancelJob", () => cancelJob(profileId!, jobId!, errJson));
      } else {
        await safe("failJob", () => failJob(profileId!, jobId!, errJson));
      }
    }

    if (generationRequestId) {
      await safe("idemFailure", () =>
        finishGenerationRequestFailure({
          id: generationRequestId!,
          profileId: profileId!,
          jobId: jobId ?? null,
          errorJson: errJson,
        })
      );
    }

    if (cancelled) {
      return NextResponse.json(
        { error: message, code: "GENERATION_CANCELLED", refunded: false },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
