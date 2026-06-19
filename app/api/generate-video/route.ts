import { NextResponse } from "next/server";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { insertUserCreation } from "@/lib/creations-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
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
import { recordUsageEvent } from "@/lib/usage-events-db";
import { supabaseServer } from "@/lib/supabase-server";
import {
  STORAGE_BUCKET,
  videosStoragePath,
  isVideosTempRefPath,
} from "@/lib/storage-buckets";
import {
  getVideoModel,
  isValidVideoModelId,
  isValidVideoResolution,
  isValidVideoAspectRatio,
  isValidVideoDuration,
  validateVideoReferences,
  buildVideoProviderInput,
  type VideoReferenceInputs,
} from "@/lib/video-models";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";

// Vercel Hobby plan caps every Serverless Function at maxDuration=300. Raising
// this above 300 makes the deployment fail outright on Hobby. Bump to 600 only
// after upgrading to Pro (see CLAUDE.md).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PROMPT_MAX_CHARS = 4000;

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

function parseRefList(raw: unknown, max: number): RefAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: RefAttachment[] = [];
  for (const item of raw) {
    const ref = parseRefAttachment(item);
    if (ref) out.push(ref);
    if (out.length >= max) break;
  }
  return out;
}

export async function POST(req: Request) {
  // Platform-observability + spend trackers — declared before the try so the
  // catch/finally blocks can finalize whatever was created.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let videoAssetId: string | null = null;
  let creditsSpent = false;
  let creditsAmount = 0;
  let generationRequestId: string | null = null;
  // Transient reference uploads to remove once we're done (success/failure/402).
  // Guarded to the videos/temp/refs/ prefix so a forged client path can't make
  // us delete arbitrary objects.
  const tempRefPaths: string[] = [];

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[video obs] ${label} failed:`, e);
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
      console.error("[video] profile resolution failed (non-auth):", e);
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
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[video] tool guard unexpected error (failing open):", e);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const prompt = String(b.prompt ?? "").trim().slice(0, PROMPT_MAX_CHARS);
    const modelId = String(b.modelId ?? "").trim();
    const duration = Number(b.duration ?? NaN);
    const resolution = String(b.resolution ?? "").trim();
    const aspectRatio = String(b.aspectRatio ?? "").trim();
    const generateAudio = b.generateAudio === true;
    const seedRaw = b.seed;
    const seed =
      typeof seedRaw === "number" && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : null;

    // ---- Validate model + options (all before any job/spend/provider) ----
    if (!modelId || !isValidVideoModelId(modelId)) {
      return NextResponse.json({ error: "Unknown video model." }, { status: 400 });
    }
    const model = getVideoModel(modelId);

    if (!prompt) {
      return NextResponse.json(
        { error: "A prompt is required to generate a video." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(duration) || !isValidVideoDuration(model, duration)) {
      return NextResponse.json(
        { error: `Duration must be one of: ${model.durations.join(", ")} seconds.` },
        { status: 400 }
      );
    }
    if (!isValidVideoResolution(model, resolution)) {
      return NextResponse.json(
        { error: `Resolution must be one of: ${model.resolutions.join(", ")}.` },
        { status: 400 }
      );
    }
    if (!isValidVideoAspectRatio(model, aspectRatio)) {
      return NextResponse.json({ error: "Unsupported aspect ratio." }, { status: 400 });
    }

    // ---- Parse reference attachments + collect their temp paths for cleanup ----
    const refsRaw = (b.references ?? {}) as Record<string, unknown>;
    const firstFrame = parseRefAttachment(refsRaw.firstFrame);
    const lastFrame = parseRefAttachment(refsRaw.lastFrame);
    const referenceImages = parseRefList(refsRaw.referenceImages, model.references.referenceImages);
    const referenceVideos = parseRefList(refsRaw.referenceVideos, model.references.referenceVideos);
    const referenceAudios = parseRefList(refsRaw.referenceAudios, model.references.referenceAudios);

    for (const ref of [firstFrame, lastFrame, ...referenceImages, ...referenceVideos, ...referenceAudios]) {
      if (ref && ref.path && isVideosTempRefPath(ref.path)) {
        tempRefPaths.push(ref.path);
      }
    }

    const referenceInputs: VideoReferenceInputs = {
      firstFrame: firstFrame?.url ?? null,
      lastFrame: lastFrame?.url ?? null,
      referenceImages: referenceImages.map((r) => r.url),
      referenceVideos: referenceVideos.map((r) => r.url),
      referenceAudios: referenceAudios.map((r) => r.url),
    };

    const refCheck = validateVideoReferences(model, referenceInputs);
    if (!refCheck.ok) {
      return NextResponse.json({ error: refCheck.error }, { status: 400 });
    }

    // A reference video bumps Seedance to its pricier "video_in" tier.
    const hasReferenceVideo = referenceVideos.length > 0;
    const pricingKey = model.pricingKey(resolution, hasReferenceVideo);

    // ---- Resolve runtime model (admin-overridable; reuses reels.video row) ----
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
      route: "generate_video",
      modelId,
      prompt,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      seed,
      pricingKey,
      firstFrame: referenceInputs.firstFrame,
      lastFrame: referenceInputs.lastFrame,
      referenceImages: referenceInputs.referenceImages,
      referenceVideos: referenceInputs.referenceVideos,
      referenceAudios: referenceInputs.referenceAudios,
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_video",
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
        jobType: "video_text2video",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        input: { modelId, duration, resolution, aspectRatio, generateAudio, pricingKey },
      })
    );
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — before any provider call) ----
    // Variant-aware: pricingKey already encodes video_in vs non_video_in.
    const requiredCredits = await getVideoCredits({ pricingKey, durationSec: duration });
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:video_text2video:${jobId}`
          : `spend:video_text2video:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Text to Video generation",
        metadata: {
          tool: "reels",
          jobType: "video_text2video",
          modelId,
          duration,
          resolution,
          aspectRatio,
          generateAudio,
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
        role: "video_text2video",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        metadata: { modelId, duration, resolution, aspectRatio, generateAudio, pricingKey },
      })
    );
    if (asset) videoAssetId = asset.id;

    // ---- Provider call (Seedance fetches the reference URLs directly) ----
    const replicate = createReplicateClient();
    const providerInput = buildVideoProviderInput({
      model,
      prompt,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      seed,
      references: referenceInputs,
    });

    await beginStep("video_generation", `${model.modelLabel} text-to-video generation`, {
      duration,
      resolution,
      aspectRatio,
    });
    console.log(
      `[Text to Video] Running ${modelRef} (duration=${duration}s, resolution=${resolution}, aspect=${aspectRatio})...`
    );
    const output = await runWithRetry(replicate, modelRef, { input: providerInput });

    const generatedVideoUrl = extractMediaUrl(output);
    if (!generatedVideoUrl.startsWith("http")) {
      throw new Error("Video model did not return a valid video URL");
    }
    await endStep({ generatedVideoUrl });

    // ---- Download the MP4 + persist to videos/ (so the sweep keeps it) ----
    await beginStep("storage_upload", "Download generated video + save to Supabase");
    const videoResponse = await fetch(generatedVideoUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const storagePath = videosStoragePath(`video_${Date.now()}.mp4`);

    const { error: uploadError } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, videoBuffer, { contentType: "video/mp4", upsert: false });
    if (uploadError) {
      throw new Error(`Failed to save video to storage: ${uploadError.message}`);
    }
    const { data: urlData } = supabaseServer.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;
    await endStep({ storagePath, publicUrl });

    const title = prompt.slice(0, 60) || "Text to Video";
    const creationMetadata = {
      prompt,
      modelId,
      providerModel: resolvedModel.model,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      pricingKey,
    };

    // user_creations row (history + sweep reference). Owner = users.id (user_id).
    let historyItem = null;
    if (userId) {
      historyItem = await safe("insertUserCreation", () =>
        insertUserCreation({
          userId: userId!,
          tool: "video_text2video",
          mediaType: "video",
          mediaUrl: publicUrl,
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
          publicUrl,
          mimeType: "video/mp4",
          durationSec: duration,
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
        units: duration,
        creditsCharged: creditsAmount,
        metadata: { jobType: "video_text2video", modelId, resolution, aspectRatio, pricingKey },
      })
    );

    const successResponse = {
      videoUrl: publicUrl,
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
    console.error("[Text to Video] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const pricingMissing = error instanceof PricingConfigError;
    const errJson = pricingMissing
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
      await safe("failJob", () => failJob(profileId!, jobId!, errJson));
    }

    // Best-effort refund. Only fires when a spend actually succeeded.
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () =>
        refundCredits({
          profileId: profileId!,
          amount: creditsAmount,
          idempotencyKey: jobId
            ? `refund:video_text2video:${jobId}`
            : `refund:video_text2video:profile:${profileId}:${Date.now()}`,
          jobId: jobId ?? null,
          description: "Best-effort refund after generation failure",
          metadata: { reason: "generation_failed", originalError: errJson },
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

    return NextResponse.json(
      pricingMissing ? { error: message, code: "PRICING_CONFIG_MISSING" } : { error: message },
      { status: 500 }
    );
  } finally {
    // Clean up the transient reference uploads regardless of outcome
    // (success / failure / insufficient credits). The 24h videos/temp/ sweep is
    // the backstop for abandoned or killed requests. Path-guarded above.
    if (tempRefPaths.length > 0) {
      try {
        await supabaseServer.storage.from(STORAGE_BUCKET).remove(tempRefPaths);
      } catch (e) {
        console.warn("[video] temp reference cleanup failed:", e);
      }
    }
  }
}
