import { NextResponse } from "next/server";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import { isCancellation, ReplicateCancellationError } from "@/lib/replicate-server";
import { makePredictionRecorder, isCancelRequested } from "@/lib/generation-cancel";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { insertUserCreation } from "@/lib/creations-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getVideoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { resolveModel, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { isCatalogModelEnabled } from "@/lib/model-catalog-configs-db";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, videosGeneratedVideoPath, isVideosTempRefPath } from "@/lib/storage-buckets";
import { resolveRefForPipeline, signStoragePathForUser } from "@/lib/storage-signed-url";
import {
  getMotionControlModel,
  isValidMotionControlModelId,
  isValidMotionControlMode,
  isValidCharacterOrientation,
  effectiveMotionControlDuration,
  motionControlRefVideoDurationError,
  buildMotionControlProviderInput,
  motionControlResolutionLabel,
  type MotionControlMode,
  type CharacterOrientation,
} from "@/lib/motion-control-models";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { resolveMentionCreations } from "@/lib/mention-assets-server";

// Vercel Hobby plan caps every Serverless Function at maxDuration=300. Raising
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
  const endStep = async (output?: Record<string, unknown>): Promise<void> => {
    const id = currentStepId;
    currentStepId = null;
    if (id && profileId) {
      await safe("finishStep", () => finishJobStep(profileId!, id, output));
    }
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

    const promptRaw = String(b.prompt ?? "").trim();
    const modelId = String(b.modelId ?? "").trim();
    const mode = String(b.mode ?? "").trim();
    const characterOrientation = String(b.characterOrientation ?? "").trim();
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
    if (!isValidCharacterOrientation(characterOrientation)) {
      return NextResponse.json(
        { error: "Character orientation must be 'image' or 'video'." },
        { status: 400 }
      );
    }

    // ---- Parse the required reference attachments + collect temp paths ----
    let imageRef = parseRefAttachment(b.image);
    const videoRef = parseRefAttachment(b.video);

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
    for (const ref of [imageRef, videoRef]) {
      if (ref.path && isVideosTempRefPath(ref.path)) tempRefPaths.push(ref.path);
    }

    const orientation = characterOrientation as CharacterOrientation;

    const durationError = motionControlRefVideoDurationError(
      Number.isFinite(refVideoDurationRaw) ? refVideoDurationRaw : null,
      orientation,
    );
    if (durationError) {
      return NextResponse.json({ error: durationError }, { status: 400 });
    }

    const billedDuration = effectiveMotionControlDuration({
      model,
      refVideoDurationSec: Number.isFinite(refVideoDurationRaw) ? refVideoDurationRaw : null,
      orientation,
    });
    const resolutionLabel = motionControlResolutionLabel(mode as MotionControlMode);
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
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_motion_control",
      toolKey: "reels",
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
        { error: "Generation already in progress, please wait.", code: "GENERATION_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (begin.action === "replay") {
      return NextResponse.json(begin.response);
    }
    generationRequestId = begin.id;

    // ---- Platform job (best-effort observability) ----
    const job = await safe("createJob", () =>
      createJob({
        profileId: profileId!,
        tool: "reels",
        jobType: "video_motion_control",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        input: { modelId, mode, characterOrientation, keepOriginalSound, billedDuration, pricingKey },
      })
    );
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — before any provider call) ----
    const requiredCredits = await getVideoCredits({ pricingKey, durationSec: billedDuration });
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:video_motion_control:${jobId}`
          : `spend:video_motion_control:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
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
      });
      creditsSpent = true;
      creditsAmount = requiredCredits;
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        const wallet = await getWallet(profileId!).catch(() => null);
        const currentBalance = wallet?.balance ?? 0;
        if (jobId) {
          await safe("failJobInsufficient", () =>
            failJob(profileId!, jobId!, {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            })
          );
        }
        if (generationRequestId) {
          await safe("idemFailInsufficient", () =>
            finishGenerationRequestFailure({
              id: generationRequestId!,
              jobId: jobId ?? null,
              errorJson: {
                code: "INSUFFICIENT_CREDITS",
                message: "Insufficient credits.",
                requiredCredits,
                currentBalance,
              },
            })
          );
        }
        return NextResponse.json(
          { error: "Insufficient credits.", requiredCredits, currentBalance },
          { status: 402 }
        );
      }
      throw e;
    }

    // ---- Processing asset (created AFTER spend succeeds) ----
    const asset = await safe("createAsset", () =>
      createProcessingAsset({
        profileId: profileId!,
        jobId: jobId ?? undefined,
        tool: "reels",
        assetType: "video",
        role: "video_motion_control",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        metadata: { modelId, mode, characterOrientation, keepOriginalSound, billedDuration, pricingKey },
      })
    );
    if (asset) videoAssetId = asset.id;

    // ---- Provider call (Kling fetches the reference URLs directly) ----
    const pipelineImageUrl = await resolveRefForPipeline(userId!, imageRef);
    const pipelineVideoUrl = await resolveRefForPipeline(userId!, videoRef);
    if (!pipelineImageUrl || !pipelineVideoUrl) {
      throw new Error("Reference attachments could not be resolved.");
    }

    const replicate = createReplicateClient();
    const providerInput = buildMotionControlProviderInput({
      prompt,
      mode: mode as MotionControlMode,
      keepOriginalSound,
      characterOrientation: orientation,
      imageUrl: pipelineImageUrl,
      videoUrl: pipelineVideoUrl,
    });

    await beginStep("motion_control_generation", `${model.modelLabel} motion control generation`, {
      mode,
      characterOrientation,
      keepOriginalSound,
      billedDuration,
    });
    // Abort before paying for a provider run the user already asked to cancel.
    if (generationRequestId && (await isCancelRequested(profileId!, generationRequestId))) {
      throw new ReplicateCancellationError();
    }
    console.log(
      `[Motion Control] Running ${modelRef} (mode=${mode}, orientation=${characterOrientation})...`
    );
    const recordPredictionTick = makePredictionRecorder({
      generationRequestId,
      profileId,
      jobId,
      kind: "video_motion_control",
    });
    const output = await runWithRetry(replicate, modelRef, { input: providerInput }, 10, {
      onPrediction: recordPredictionTick,
    });

    // Post-run cancel safety net (see generate-storyboard-video): honor a cancel
    // that landed in the provider's pre-poll window with a refund + no delivery.
    if (generationRequestId && profileId && (await isCancelRequested(profileId!, generationRequestId))) {
      throw new ReplicateCancellationError();
    }

    const generatedVideoUrl = extractMediaUrl(output);
    if (!generatedVideoUrl.startsWith("http")) {
      throw new Error("Motion control model did not return a valid video URL");
    }
    await endStep({ generatedVideoUrl });

    // ---- Download the MP4 + persist to videos/ (so the sweep keeps it) ----
    await beginStep("storage_upload", "Download generated video + save to Supabase");
    const videoResponse = await fetch(generatedVideoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const storagePath = videosGeneratedVideoPath(userId!, "motion-control", `video_${Date.now()}.mp4`);

    const { error: uploadError } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, videoBuffer, { contentType: "video/mp4", upsert: false });
    if (uploadError) {
      throw new Error(`Failed to save video to storage: ${uploadError.message}`);
    }
    const { url: publicUrl } = await signStoragePathForUser(storagePath, userId!, "ui");
    await endStep({ storagePath, publicUrl });

    const title = prompt.slice(0, 60) || "Motion Control";
    const creationMetadata = {
      prompt,
      modelId,
      modelLabel: model.modelLabel,
      providerModel: resolvedModel.model,
      mode,
      resolution: resolutionLabel,
      characterOrientation,
      keepOriginalSound,
      billedDuration,
      pricingKey,
    };

    let historyItem = null;
    if (userId) {
      historyItem = await safe("insertUserCreation", () =>
        insertUserCreation({
          userId: userId!,
          tool: "video_motion_control",
          mediaType: "video",
          mediaUrl: storagePath,
          storagePath,
          title,
          metadata: creationMetadata,
        })
      );
    }

    if (videoAssetId && profileId) {
      await safe("markAssetReady", () =>
        markAssetReady(profileId!, videoAssetId!, {
          storagePath,
          mimeType: "video/mp4",
          durationSec: billedDuration,
          costCredits: creditsAmount,
          metadata: creationMetadata,
        })
      );
    }
    if (jobId && profileId) {
      await safe("finishJob", () =>
        finishJob(profileId!, jobId!, {
          output: { videoUrl: publicUrl, storagePath, assetId: videoAssetId },
          costCredits: creditsAmount,
        })
      );
    }

    await safe("recordUsage", () =>
      recordUsageEvent({
        profileId: profileId!,
        jobId: jobId ?? null,
        assetId: videoAssetId ?? null,
        tool: "reels",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        unitType: "video_seconds",
        units: billedDuration,
        creditsCharged: creditsAmount,
        metadata: { jobType: "video_motion_control", modelId, mode, pricingKey },
      })
    );

    const successResponse = {
      videoUrl: publicUrl,
      storagePath,
      historyItem,
      savedToCloud: true,
    };
    if (generationRequestId) {
      await safe("idemSuccess", () =>
        finishGenerationRequestSuccess({
          id: generationRequestId!,
          jobId: jobId ?? null,
          assetId: videoAssetId ?? null,
          responseJson: successResponse,
        })
      );
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    // User cancellation is a normal outcome: job → 'cancelled' + refund (below).
    const cancelled = isCancellation(error);
    const message = cancelled
      ? "Generation cancelled."
      : error instanceof Error
        ? error.message
        : String(error);
    if (cancelled) console.log("[Motion Control] Cancelled by user.");
    else console.error("[Motion Control] Error:", error);
    const pricingMissing = error instanceof PricingConfigError;
    const errJson = cancelled
      ? { message, code: "GENERATION_CANCELLED" }
      : pricingMissing
        ? { message, code: "PRICING_CONFIG_MISSING" }
        : { message };

    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
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

    // Best-effort refund. Fires on both failures and user cancellations.
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () =>
        refundCredits({
          profileId: profileId!,
          amount: creditsAmount,
          idempotencyKey: jobId
            ? `refund:video_motion_control:${jobId}`
            : `refund:video_motion_control:profile:${profileId}:${Date.now()}`,
          jobId: jobId ?? null,
          description: cancelled
            ? "Refund after user cancellation"
            : "Best-effort refund after generation failure",
          metadata: { reason: cancelled ? "generation_cancelled" : "generation_failed", originalError: errJson },
        })
      );
    }

    if (generationRequestId) {
      await safe("idemFailure", () =>
        finishGenerationRequestFailure({
          id: generationRequestId!,
          jobId: jobId ?? null,
          errorJson: errJson,
        })
      );
    }

    if (cancelled) {
      return NextResponse.json(
        { error: message, code: "GENERATION_CANCELLED", refunded: creditsSpent },
        { status: 409 }
      );
    }
    return NextResponse.json(
      pricingMissing ? { error: message, code: "PRICING_CONFIG_MISSING" } : { error: message },
      { status: 500 }
    );
  } finally {
    if (tempRefPaths.length > 0) {
      try {
        await supabaseServer.storage.from(STORAGE_BUCKET).remove(tempRefPaths);
      } catch (e) {
        console.warn("[motion-control] temp reference cleanup failed:", e);
      }
    }
  }
}
