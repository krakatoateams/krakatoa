import { NextResponse } from "next/server";
import { createReplicateClient, createPredictionWithRetry } from "@/lib/replicate-utils";
import { isCancellation, ReplicateCancellationError } from "@/lib/replicate-server";
import { makePredictionRecorder, isCancelRequested } from "@/lib/generation-cancel";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob } from "@/lib/jobs-db";
import { createJobStep } from "@/lib/job-steps-db";
import {
  beginMeteredAttempt,
  finishMeteredAttempt,
  type MeteredAttemptHandle,
} from "@/lib/metered-generation/lifecycle";
import { getVideoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { resolveModel, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { isCatalogModelEnabled } from "@/lib/model-catalog-configs-db";
import { supabaseServer } from "@/lib/supabase-server";
import { isVideosTempRefPath } from "@/lib/storage-buckets";
import { resolveRefForPipeline } from "@/lib/storage-signed-url";
import {
  getMotionControlModel,
  isValidMotionControlModelId,
  isValidMotionControlMode,
  DEFAULT_CHARACTER_ORIENTATION,
  effectiveMotionControlDuration,
  motionControlRefVideoDurationError,
  buildMotionControlProviderInput,
  type MotionControlMode,
} from "@/lib/motion-control-models";
import type { MotionControlJobInput } from "@/lib/motion-control-context";
import {
  buildMotionControlFinalizeContext,
} from "@/lib/motion-control-context";
import {
  cleanupMotionControlTempRefs,
  finalizeMotionControlSuccess,
  endMotionControlStep,
} from "@/lib/motion-control-finalize";
import {
  DevBlankForbiddenError,
  isDevBlankRequested,
  readBlankVideoBytes,
  requireDevBlankAccess,
  devBlankJobTag,
} from "@/lib/dev-blank-generation";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  attachGenerationRequestJob,
} from "@/lib/generation-idempotency";
import { resolveMentionCreations } from "@/lib/mention-assets-server";
import { motionControlGenerationVideoUrl } from "@/lib/trending-templates";
import { start } from "workflow/api";
import { resolveExecutionBackendForJobType } from "@/lib/generation-workflows/feature-flags";
import { attachWorkflowRun } from "@/lib/generation-workflows/workflow-db";
import { motionControlGenerationWorkflow } from "@/lib/generation-workflows/motion-control-workflow";
import type { MotionControlWorkflowParams } from "@/lib/generation-workflows/motion-control-workflow-types";
// this above 300 makes the deployment fail outright on Hobby. Bump to 600 only
// after upgrading to Pro (see CLAUDE.md).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** A reference attachment as sent by the client: a public URL + its temp storage path. */
type RefAttachment = { url: string; path: string };

function parseRefAttachment(raw: unknown): RefAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  const path = typeof obj.path === "string" ? obj.path.trim() : "";
  if (!url.startsWith("http")) return null;
  return { url, path };
}

export async function POST(req: Request) {
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let videoAssetId: string | null = null;
  let creditsSpent = false;
  let creditsAmount = 0;
  let generationRequestId: string | null = null;
  let metered: MeteredAttemptHandle | null = null;
  let predictionStarted = false;
  let workflowStarted = false;
  const tempRefPaths: string[] = [];

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[motion-control obs] ${label} failed:`, e);
      return null;
    }
  };

  const beginStep = async (
    stepKey: string,
    stepName: string,
    input?: Record<string, unknown>
  ): Promise<void> => {
    if (!jobId || !profileId) return;
    const row = await safe(`beginStep:${stepKey}`, () =>
      createJobStep({
        jobId: jobId!,
        profileId: profileId!,
        stepKey,
        stepName,
        status: "running",
        input,
      })
    );
    currentStepId = row?.id ?? null;
  };

  try {
    // STRICT profile resolution (this route charges credits).
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[motion-control] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // Tool-access guard. Reuses the existing "reels" tool key for gating.
    try {
      await assertToolEnabled("reels");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json({ error: e.message, code: "TOOL_DISABLED" }, { status: 403 });
      }
      console.warn("[motion-control] tool guard unexpected error (failing open):", e);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const devBlank = isDevBlankRequested(b);
    if (devBlank) {
      try {
        await requireDevBlankAccess();
      } catch (e) {
        if (e instanceof DevBlankForbiddenError) {
          return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
        }
        throw e;
      }
    }

    const promptRaw = String(b.prompt ?? "").trim();
    const modelId = String(b.modelId ?? "").trim();
    const mode = String(b.mode ?? "").trim();
    const keepOriginalSound = b.keepOriginalSound !== false; // default true
    const refVideoDurationRaw = Number(b.refVideoDurationSec ?? NaN);
    const characterCreationId =
      typeof b.characterCreationId === "string" ? b.characterCreationId.trim() : "";

    // ---- Validate model + options (all before any job/spend/provider) ----
    if (!modelId || !isValidMotionControlModelId(modelId)) {
      return NextResponse.json({ error: "Unknown motion control model." }, { status: 400 });
    }
    const model = getMotionControlModel(modelId);
    if (!(await isCatalogModelEnabled("reels", modelId))) {
      return NextResponse.json({ error: "This model isn't available." }, { status: 400 });
    }
    const prompt = promptRaw.slice(0, model.promptMaxChars);

    if (!isValidMotionControlMode(model, mode)) {
      return NextResponse.json(
        { error: `Mode must be one of: ${model.modes.join(", ")}.` },
        { status: 400 }
      );
    }
    const characterOrientation = DEFAULT_CHARACTER_ORIENTATION;

    // ---- Parse the required reference attachments + collect temp paths ----
    let imageRef = parseRefAttachment(b.image);
    let videoRef = parseRefAttachment(b.video);

    if (characterCreationId && userId) {
      const resolved = await resolveMentionCreations(userId, [characterCreationId]);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      imageRef = { url: resolved.items[0].url, path: "" };
    }

    if (!imageRef) {
      return NextResponse.json({ error: "A reference image is required." }, { status: 400 });
    }
    if (!videoRef) {
      return NextResponse.json({ error: "A reference video is required." }, { status: 400 });
    }
    // Dashboard templates may preview webm; pipeline always needs the MP4 twin on CDN.
    if (videoRef.url && !videoRef.path?.trim()) {
      videoRef = { ...videoRef, url: motionControlGenerationVideoUrl(videoRef.url) };
    }
    for (const ref of [imageRef, videoRef]) {
      if (ref.path && isVideosTempRefPath(ref.path)) tempRefPaths.push(ref.path);
    }

    const durationError = motionControlRefVideoDurationError(
      Number.isFinite(refVideoDurationRaw) ? refVideoDurationRaw : null,
    );
    if (durationError) {
      return NextResponse.json({ error: durationError }, { status: 400 });
    }

    const billedDuration = effectiveMotionControlDuration({
      model,
      refVideoDurationSec: Number.isFinite(refVideoDurationRaw) ? refVideoDurationRaw : null,
    });
    const pricingKey = model.pricingKey(mode as MotionControlMode);

    // ---- Resolve runtime model (admin-overridable; falls back to providerModel) ----
    const resolvedModel = await resolveModel({
      toolKey: "reels",
      configKey: model.modelRole,
      fallback: { provider: "replicate", model: model.providerModel, parameters: {} },
    });
    const modelRef = replicateRef(resolvedModel);

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      route: "generate_motion_control",
      modelId,
      prompt,
      mode,
      characterOrientation,
      keepOriginalSound,
      billedDuration,
      pricingKey,
      characterCreationId,
      image: imageRef.url,
      video: videoRef.url,
    });
    const executionBackend = resolveExecutionBackendForJobType("video_motion_control");
    const isWorkflowBackend = executionBackend === "workflow";
    const requiredCredits = devBlank
      ? 0
      : await getVideoCredits({ pricingKey, durationSec: billedDuration });
    const beginResult = await beginMeteredAttempt({
      profileId: profileId!,
      userId,
      idempotency: {
        key: idemKey,
        routeKey: "generate_motion_control",
        toolKey: "reels",
        requestHash,
      },
      earlyExits: {
        inProgress: {
          status: 202,
          body: { status: "processing", code: "GENERATION_IN_PROGRESS" },
        },
      },
      createJobFn: async (genReqId) => {
        if (isWorkflowBackend) {
          const job = await createJob({
            profileId: profileId!,
            tool: "reels",
            jobType: "video_motion_control",
            executionBackend,
            provider: resolvedModel.provider,
            model: resolvedModel.model,
            input: {
              modelId,
              mode,
              characterOrientation,
              keepOriginalSound,
              billedDuration,
              pricingKey,
              prompt,
              provider: resolvedModel.provider,
              providerModel: resolvedModel.model,
              tempRefPaths: [...tempRefPaths],
              generationRequestId: genReqId,
            } satisfies MotionControlJobInput,
          });
          await startJob(profileId!, job.id);
          await attachGenerationRequestJob({
            id: genReqId,
            profileId: profileId!,
            jobId: job.id,
          });
          return job.id;
        }
        const job = await safe("createJob", () =>
          createJob({
            profileId: profileId!,
            tool: "reels",
            jobType: "video_motion_control",
            executionBackend,
            provider: resolvedModel.provider,
            model: resolvedModel.model,
            input: {
              modelId,
              mode,
              characterOrientation,
              keepOriginalSound,
              billedDuration,
              pricingKey,
              prompt,
              provider: resolvedModel.provider,
              providerModel: resolvedModel.model,
              tempRefPaths: [...tempRefPaths],
              generationRequestId: genReqId,
            } satisfies MotionControlJobInput,
          }),
        );
        if (!job) return null;
        await safe("startJob", () => startJob(profileId!, job.id));
        await safe("attachJob", () =>
          attachGenerationRequestJob({
            id: genReqId,
            profileId: profileId!,
            jobId: job.id,
          }),
        );
        return job.id;
      },
      spend: {
        amount: requiredCredits,
        jobType: "video_motion_control",
        description: "Motion Control generation",
        metadata: {
          tool: "reels",
          jobType: "video_motion_control",
          modelId,
          mode,
          characterOrientation,
          keepOriginalSound,
          billedDuration,
          pricingKey,
          providerModel: resolvedModel.model,
        },
        skip: devBlank,
      },
      processingAssets: [
        {
          tool: "reels",
          assetType: "video",
          role: "video_motion_control",
          provider: devBlank ? "dev_blank" : resolvedModel.provider,
          model: devBlank ? "dev_blank" : resolvedModel.model,
          metadata: {
            modelId,
            mode,
            characterOrientation,
            keepOriginalSound,
            billedDuration,
            pricingKey,
            ...(devBlank ? devBlankJobTag() : {}),
          },
        },
      ],
    });
    if (beginResult.kind === "early_exit") {
      return NextResponse.json(beginResult.http.body, { status: beginResult.http.status });
    }
    metered = beginResult.handle;
    jobId = metered.jobId;
    generationRequestId = metered.generationRequestId;
    creditsSpent = metered.creditsSpent;
    creditsAmount = metered.creditsAmount;
    videoAssetId = metered.assetIds[0] ?? null;

    if (isWorkflowBackend && (!jobId || !generationRequestId)) {
      throw new Error("Workflow motion control requires a persisted job and generation request.");
    }

    if (jobId) {
      await safe("patchJobInput", async () => {
        const { error } = await supabaseServer
          .from("jobs")
          .update({
            input: {
              modelId,
              mode,
              characterOrientation,
              keepOriginalSound,
              billedDuration,
              pricingKey,
              prompt,
              provider: resolvedModel.provider,
              providerModel: resolvedModel.model,
              creditsAmount,
              tempRefPaths: [...tempRefPaths],
              generationRequestId: generationRequestId ?? undefined,
              videoAssetId: videoAssetId ?? undefined,
            } satisfies MotionControlJobInput,
          })
          .eq("id", jobId)
          .eq("profile_id", profileId!);
        if (error) throw error;
      });
    }
    if (generationRequestId) {
      await safe("attachGenerationRequest", () =>
        attachGenerationRequestJob({
          id: generationRequestId!,
          profileId: profileId!,
          jobId,
          assetId: videoAssetId,
        })
      );
    }

    if (devBlank) {
      await beginStep("dev_blank", "Deliver blank placeholder video (admin test)");
      const ctx = buildMotionControlFinalizeContext({
        profileId: profileId!,
        userId: userId!,
        jobId,
        videoAssetId,
        generationRequestId,
        creditsAmount,
        prompt,
        jobInput: {
          modelId,
          mode: mode as MotionControlMode,
          characterOrientation,
          keepOriginalSound,
          billedDuration,
          pricingKey,
          prompt,
          provider: "dev_blank",
          providerModel: "dev_blank",
          creditsAmount,
          tempRefPaths: [...tempRefPaths],
          generationRequestId: generationRequestId ?? undefined,
          videoAssetId: videoAssetId ?? undefined,
        },
      });
      const blankBuffer = await readBlankVideoBytes("9:16");
      const successResponse = await finalizeMotionControlSuccess(ctx, blankBuffer, {
        devBlank: true,
      });
      await endMotionControlStep(profileId!, currentStepId, { devBlank: true });
      currentStepId = null;
      return NextResponse.json(successResponse);
    }

    // ---- Start provider prediction (non-blocking — finalize via /status) ----
    const pipelineImageUrl = await resolveRefForPipeline(userId!, imageRef);
    const pipelineVideoUrl = await resolveRefForPipeline(userId!, videoRef);
    if (!pipelineImageUrl || !pipelineVideoUrl) {
      throw new Error("Reference attachments could not be resolved.");
    }

    const providerInput = buildMotionControlProviderInput({
      prompt,
      mode: mode as MotionControlMode,
      keepOriginalSound,
      characterOrientation,
      imageUrl: pipelineImageUrl,
      videoUrl: pipelineVideoUrl,
    });

    if (executionBackend === "workflow") {
      const workflowParams: MotionControlWorkflowParams = {
        profileId: profileId!,
        userId: userId!,
        jobId: jobId!,
        generationRequestId: generationRequestId!,
        videoAssetId,
        creditsAmount,
        modelRef: modelRef,
        providerInput,
        modelId,
        mode: mode as MotionControlMode,
        characterOrientation,
        keepOriginalSound,
        billedDuration,
        pricingKey,
        prompt,
        provider: resolvedModel.provider,
        providerModel: resolvedModel.model,
        tempRefPaths: [...tempRefPaths],
        stepLabel: `${model.modelLabel} motion control generation`,
      };

      console.log(
        `[Motion Control] Starting durable workflow (mode=${mode}, orientation=${characterOrientation})...`,
      );

      const run = await start(motionControlGenerationWorkflow, [workflowParams]);
      workflowStarted = true;
      try {
        await attachWorkflowRun({
          profileId: profileId!,
          jobId: jobId!,
          workflowRunId: run.runId,
        });
      } catch (attachError) {
        console.warn(
          "[motion-control] attachWorkflowRun failed after workflow start (run already executing):",
          attachError,
        );
      }

      return NextResponse.json(
        { status: "processing", jobId, runId: run.runId },
        { status: 202 },
      );
    }

    const replicate = createReplicateClient();
    await beginStep("motion_control_generation", `${model.modelLabel} motion control generation`, {
      mode,
      characterOrientation,
      keepOriginalSound,
      billedDuration,
    });
    if (generationRequestId && (await isCancelRequested(profileId!, generationRequestId))) {
      throw new ReplicateCancellationError();
    }
    console.log(
      `[Motion Control] Starting ${modelRef} (mode=${mode}, orientation=${characterOrientation})...`
    );
    const recordPredictionTick = makePredictionRecorder({
      generationRequestId,
      profileId,
      jobId,
      kind: "video_motion_control",
    });
    const prediction = await createPredictionWithRetry(replicate, modelRef, providerInput);
    predictionStarted = true;
    recordPredictionTick?.({ id: prediction.id, status: "starting" });

    return NextResponse.json(
      { status: "processing", predictionId: prediction.id },
      { status: 202 },
    );
  } catch (error: unknown) {
    const cancelled = isCancellation(error);
    const pricingMissing = error instanceof PricingConfigError;
    const rawMessage = error instanceof Error ? error.message : String(error);
    if (cancelled) console.log("[Motion Control] Cancelled by user.");
    else console.error("[Motion Control] Error:", error);
    const handle =
      metered ??
      (profileId
        ? {
            profileId,
            userId: null,
            jobId,
            generationRequestId,
            creditsSpent,
            creditsAmount,
            assetIds: videoAssetId ? [videoAssetId] : [],
            refundJobType: "video_motion_control",
          }
        : null);
    if (handle) {
      if (videoAssetId) handle.assetIds = [videoAssetId];
      const finished = await finishMeteredAttempt(handle, {
        kind: "terminal",
        cancelled,
        pricingMissing,
        rawMessage,
        currentStepId,
        clearCurrentStep: () => {
          currentStepId = null;
        },
        genericClientError: pricingMissing
          ? undefined
          : "Motion control generation failed.",
      });
      if (finished.http) {
        return NextResponse.json(finished.http.body, { status: finished.http.status });
      }
    }
    return NextResponse.json(
      { error: "Motion control generation failed." },
      { status: 500 },
    );
  } finally {
    if (tempRefPaths.length > 0 && !predictionStarted && !workflowStarted) {
      await cleanupMotionControlTempRefs(tempRefPaths);
    }
  }
}
