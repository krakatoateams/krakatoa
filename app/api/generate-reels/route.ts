/**
 * =============================================================================
 * Unified Reels Creator route — POST /api/generate-reels
 * =============================================================================
 * One handler for the whole Reels Creator subtool (Video studio). It owns the
 * cross-cutting contract — profile resolution, tool gate, request-level
 * idempotency, the credit spend/refund flow, job/asset lifecycle, usage events,
 * and history — then dispatches by validated engine/mode into the shared
 * pipeline modules in `lib/reels-pipeline/`:
 *
 *   engine "seedance"            -> runSeedancePipeline      (job reels_seedance, tool reels)
 *   engine "veo" mode "single"   -> runVeoSinglePipeline     (job veo_single,     tool veo)
 *   engine "veo" mode "perScene" -> runVeoPerScenePipeline   (job veo_perscene,   tool veo)
 *
 * All billing/observability identifiers are kept identical to the two legacy
 * routes it replaces (job types, jobs.tool, creation tools, spend/refund keys,
 * storage filenames) so credits, history, and the scheduler keep working. The
 * only request-level change is the new route_key "generate_reels".
 * =============================================================================
 */
import { NextResponse } from "next/server";
import { insertUserCreation } from "@/lib/creations-db";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import {
  createProcessingAsset,
  markAssetReady,
  markAssetFailed,
} from "@/lib/assets-db";
import { isCancellation } from "@/lib/replicate-server";
import { makePredictionRecorder, isCancelRequested } from "@/lib/generation-cancel";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getSeedanceCredits, getVeoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getReelsModels, getVeoModels, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { createReplicateClient } from "@/lib/replicate-utils";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { validateReelsRequest, REELS_ENGINE_CATALOG_MODEL_ID } from "@/lib/reels-models";
import { getVideoComposerEnablement } from "@/lib/feature-model-configs-db";
import {
  runSeedancePipeline,
  runVeoSinglePipeline,
  runVeoPerScenePipeline,
} from "@/lib/reels-pipeline";
import type {
  ReelsModelSet,
  ReelsPipelineContext,
  ReelsPipelineResult,
} from "@/lib/reels-pipeline/types";

// Vercel Hobby plan caps serverless functions at 300s (Pro allows up to 800s).
export const maxDuration = 300;

export async function POST(req: Request) {
  // Platform-observability + billing trackers — declared before the try so the
  // catch block can finalize whatever was created. They stay null/false when a
  // step was skipped, which makes every platform write below a guarded no-op.
  let profileId: string | null = null;
  let userId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let finalAssetId: string | null = null;
  let generationRequestId: string | null = null;
  // Credit-spend trackers. `creditsSpent` is the gate; without it the catch
  // block must NOT refund (no spend = no debt). `jobType` keys the refund.
  let creditsSpent = false;
  let creditsAmount = 0;
  let jobType: "reels_seedance" | "veo_single" | "veo_perscene" | null = null;

  // Best-effort wrapper for platform writes: observability must NEVER crash the
  // generation pipeline or mask the real generation error.
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[reels obs] ${label} failed:`, e);
      return null;
    }
  };

  // Step-recording helpers (best-effort; manage currentStepId). A step is only
  // recorded when both a profile and a job exist; otherwise these are no-ops.
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
    // ---- STRICT profile resolution (this route charges credits) ----
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
    //   profile.user_id -> legacy user_creations dual-write (= users.id)
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[reels] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // ---- Tool-access guard (Admin Phase 2) ----
    // Both engines live under tool_key 'reels'. 403 only when an admin disabled
    // it; missing config / DB errors fail open so config issues never cause an outage.
    try {
      await assertToolEnabled("reels");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[reels] tool guard unexpected error (failing open):", e);
    }

    // ---- Validate + normalize the request (single source of truth) ----
    const body = await req.json();
    const validated = validateReelsRequest(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status });
    }
    const reqv = validated.value;
    jobType = reqv.jobType;

    const composerEnablement = await getVideoComposerEnablement();
    const engineCatalogModelId = REELS_ENGINE_CATALOG_MODEL_ID[reqv.engine];
    if (!composerEnablement["reels-creator"].enabledTiers.includes(engineCatalogModelId)) {
      return NextResponse.json({ error: "This engine isn't available." }, { status: 400 });
    }

    // ---- Fail fast on misconfig BEFORE any credit spend ----
    const replicate = createReplicateClient(); // throws if REPLICATE_API_TOKEN missing
    const rendiApiKey = process.env.RENDI_API_KEY;
    if (!rendiApiKey) {
      return NextResponse.json({ error: "RENDI_API_KEY is not set." }, { status: 500 });
    }

    // ---- Resolve runtime models (Admin Phase 2) ----
    // Seedance resolves the 'reels' tool config; Veo resolves the 'veo' tool
    // config — preserving the existing model_configs layout (no DB migration).
    const models: ReelsModelSet =
      reqv.engine === "veo" ? await getVeoModels() : await getReelsModels();
    const refs = {
      llmRef: replicateRef(models.llm),
      videoRef: replicateRef(models.video),
      ttsRef: replicateRef(models.tts),
      whisperRef: replicateRef(models.whisper),
    };

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    // MUST run before createJob, spendCredits, or any provider call. The hash is
    // computed from normalized client inputs only (never the key, pricing, or
    // resolved model config).
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash(
      reqv.engine === "seedance"
        ? {
            engine: "seedance",
            theme: reqv.theme,
            numScenes: reqv.numScenes,
            durationPerScene: reqv.durationPerScene,
            resolution: reqv.resolution,
            voiceId: reqv.voiceId,
            emotion: reqv.emotion,
            captionStyle: reqv.style,
          }
        : {
            engine: "veo",
            mode: reqv.mode,
            theme: reqv.theme,
            captionStyle: reqv.style,
            voiceId: reqv.voiceId,
            emotion: reqv.emotion,
            duration: reqv.duration,
            resolution: reqv.resolution,
            ...(reqv.mode === "single"
              ? { singlePromptScenes: reqv.singlePromptScenes }
              : { numScenes: reqv.numScenes }),
          }
    );
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_reels",
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
    // Asset creation is deferred until AFTER the credit spend succeeds.
    const jobInput: Record<string, unknown> =
      reqv.engine === "seedance"
        ? {
            engine: "seedance",
            theme: reqv.theme.slice(0, 500),
            numScenes: reqv.numScenes,
            durationPerScene: reqv.durationPerScene,
            totalDuration: reqv.totalDuration,
            resolution: reqv.resolution,
            voiceId: reqv.voiceId,
            emotion: reqv.emotion,
          }
        : {
            engine: "veo",
            theme: reqv.theme.slice(0, 500),
            mode: reqv.mode,
            duration: reqv.duration,
            totalDuration: reqv.totalDuration,
            resolution: reqv.resolution,
            voiceId: reqv.voiceId,
            emotion: reqv.emotion,
            ...(reqv.mode === "single"
              ? { singlePromptScenes: reqv.singlePromptScenes }
              : { numScenes: reqv.numScenes }),
          };
    const job = await safe("createJob", () =>
      createJob({
        profileId: profileId!,
        tool: reqv.jobTool,
        jobType: reqv.jobType,
        provider: models.video.provider,
        model: models.video.model,
        input: jobInput,
      })
    );
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — not safe-wrapped) ----
    // Compute cost from central pricing config and debit BEFORE any provider
    // call. PricingConfigError (unknown key) throws here, before the spend, and
    // bubbles to the outer catch as a 500 with no charge. jobId-based idempotency
    // prevents double-charges on in-flight retries within this request.
    const requiredCredits =
      reqv.engine === "veo"
        ? await getVeoCredits({ resolution: reqv.resolution, durationSec: reqv.totalDuration })
        : await getSeedanceCredits({ resolution: reqv.resolution, durationSec: reqv.totalDuration });
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:${reqv.jobType}:${jobId}`
          : `spend:${reqv.jobType}:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description:
          reqv.engine === "seedance"
            ? "ReelsGen (Seedance) generation"
            : reqv.mode === "single"
              ? "Veo single-clip generation"
              : "Veo per-scene generation",
        metadata: {
          tool: reqv.jobTool,
          jobType: reqv.jobType,
          engine: reqv.engine,
          totalDuration: reqv.totalDuration,
          ...(reqv.engine === "seedance"
            ? { sceneCount: reqv.numScenes, durationPerScene: reqv.durationPerScene }
            : reqv.mode === "single"
              ? { mode: "single", duration: reqv.duration, singlePromptScenes: reqv.singlePromptScenes }
              : { mode: "perScene", duration: reqv.duration, sceneCount: reqv.numScenes }),
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
      // Non-balance infra failure: bubble to the outer catch as a 500.
      // creditsSpent stays false so no refund is attempted.
      throw e;
    }

    // ---- Processing asset (created AFTER spend succeeds) ----
    const asset = await safe("createAsset", () =>
      createProcessingAsset({
        profileId: profileId!,
        jobId: jobId ?? undefined,
        tool: reqv.jobTool,
        assetType: "video",
        role: "final_video",
        provider: models.video.provider,
        model: models.video.model,
        metadata: {
          theme: reqv.theme.slice(0, 200),
          engine: reqv.engine,
          ...(reqv.engine === "veo" ? { mode: reqv.mode } : {}),
        },
      })
    );
    if (asset) finalAssetId = asset.id;

    // ---- Build the pipeline context + dispatch ----
    const ctx: ReelsPipelineContext = {
      replicate,
      rendiApiKey,
      models,
      refs,
      log: { beginStep, endStep },
      isCancelled: async () =>
        generationRequestId && profileId
          ? isCancelRequested(profileId, generationRequestId)
          : false,
      recorder: {
        onPrediction: makePredictionRecorder({
          generationRequestId,
          profileId,
          jobId,
          kind: reqv.jobType,
        }),
      },
    };

    let result: ReelsPipelineResult;
    if (reqv.engine === "seedance") {
      result = await runSeedancePipeline(ctx, {
        theme: reqv.theme,
        sceneCount: reqv.numScenes,
        durationPerScene: reqv.durationPerScene,
        resolution: reqv.resolution,
        voiceId: reqv.voiceId,
        emotion: reqv.emotion,
        style: reqv.style,
      });
    } else if (reqv.mode === "single") {
      result = await runVeoSinglePipeline(ctx, {
        theme: reqv.theme,
        duration: reqv.duration,
        resolution: reqv.resolution,
        voiceId: reqv.voiceId,
        emotion: reqv.emotion,
        singlePromptScenes: reqv.singlePromptScenes!,
        style: reqv.style,
      });
    } else {
      result = await runVeoPerScenePipeline(ctx, {
        theme: reqv.theme,
        duration: reqv.duration,
        resolution: reqv.resolution,
        voiceId: reqv.voiceId,
        emotion: reqv.emotion,
        sceneCount: reqv.numScenes!,
        style: reqv.style,
      });
    }

    // ---- Finalize (asset -> history -> job -> usage -> idempotency) ----
    // costCredits on the asset/job is a display snapshot only; the ledger row
    // created by spendCredits is the billing source of truth.
    if (finalAssetId && profileId) {
      await safe("markAssetReady", () =>
        markAssetReady(profileId!, finalAssetId!, {
          storagePath: result.storagePath,
          publicUrl: result.videoUrl,
          mimeType: "video/mp4",
          durationSec: result.durationSec,
          width: result.width,
          height: result.height,
          costCredits: creditsAmount,
          metadata:
            reqv.engine === "seedance"
              ? {
                  engine: "seedance",
                  numScenes: reqv.numScenes,
                  durationPerScene: reqv.durationPerScene,
                  resolution: reqv.resolution,
                  voiceId: reqv.voiceId,
                  emotion: reqv.emotion,
                  llmModel: models.llm.model,
                }
              : {
                  engine: "veo",
                  mode: reqv.mode,
                  duration: reqv.duration,
                  resolution: reqv.resolution,
                  voiceId: reqv.voiceId,
                  emotion: reqv.emotion,
                },
        })
      );
    }

    // Legacy dual-write — success-only (user_creations requires a real media_url).
    // Both engines now write history (Veo single did not before; tagging it
    // reels_veo is a safe, consistent improvement).
    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: reqv.creationTool,
        mediaType: "video",
        mediaUrl: result.videoUrl,
        storagePath: result.storagePath,
        title: reqv.theme.slice(0, 200),
        metadata:
          reqv.engine === "seedance"
            ? {
                engine: "seedance",
                modelLabel: "Seedance 2 Fast",
                numScenes: reqv.numScenes,
                durationPerScene: reqv.durationPerScene,
                resolution: reqv.resolution,
                voiceId: reqv.voiceId,
                emotion: reqv.emotion,
                prompt: reqv.theme,
                scenePrompts: result.scenePrompts,
                narration: result.narration,
              }
            : {
                engine: "veo",
                modelLabel: "Veo 3.1 Lite",
                mode: reqv.mode,
                duration: reqv.duration,
                resolution: reqv.resolution,
                voiceId: reqv.voiceId,
                emotion: reqv.emotion,
                prompt: reqv.theme,
                scenePrompts: result.scenePrompts,
                narration: result.narration,
              },
      });
    } catch (historyErr) {
      console.warn("[reels] History log failed (video still saved):", historyErr);
    }

    if (jobId && profileId) {
      await safe("finishJob", () =>
        finishJob(profileId!, jobId!, {
          output: {
            videoUrl: result.videoUrl,
            storagePath: result.storagePath,
            assetId: finalAssetId,
          },
          costCredits: creditsAmount,
        })
      );
    }

    // Usage event — analytics only, NEVER affects billing/response.
    await safe("recordUsage", () =>
      recordUsageEvent({
        profileId: profileId!,
        jobId: jobId ?? null,
        assetId: finalAssetId ?? null,
        tool: reqv.jobTool,
        provider: models.video.provider,
        model: models.video.model,
        unitType: "video_seconds",
        units: reqv.totalDuration,
        creditsCharged: creditsAmount,
        metadata:
          reqv.engine === "seedance"
            ? {
                jobType: reqv.jobType,
                sceneCount: reqv.numScenes,
                durationPerScene: reqv.durationPerScene,
                resolution: reqv.resolution,
              }
            : reqv.mode === "single"
              ? {
                  jobType: reqv.jobType,
                  duration: reqv.duration,
                  resolution: reqv.resolution,
                  singlePromptScenes: reqv.singlePromptScenes,
                }
              : {
                  jobType: reqv.jobType,
                  duration: reqv.duration,
                  resolution: reqv.resolution,
                  sceneCount: reqv.numScenes,
                },
      })
    );

    // Standardized response for ALL engines. Persisted on the idempotency row so
    // a duplicate same-key request replays this exact body without regenerating.
    const successResponse = { videoUrl: result.videoUrl, historyItem };
    if (generationRequestId) {
      await safe("idemSuccess", () =>
        finishGenerationRequestSuccess({
          id: generationRequestId!,
          jobId: jobId ?? null,
          assetId: finalAssetId ?? null,
          responseJson: successResponse,
        })
      );
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    // User cancellation is a normal outcome: job -> 'cancelled' + refund (below).
    const cancelled = isCancellation(error);
    if (cancelled) console.log("[reels] Cancelled by user.");
    else console.error("[reels] pipeline error:", error);

    // Pricing fail-closed (v2.2): an unknown pricing key throws BEFORE the spend
    // and any provider call, so no credits were charged and no provider ran.
    const pricingMissing = error instanceof PricingConfigError;
    const message = cancelled
      ? "Generation cancelled."
      : error instanceof Error
        ? error.message
        : String(error);
    const errJson = cancelled
      ? { message, code: "GENERATION_CANCELLED" }
      : pricingMissing
        ? { message, code: "PRICING_CONFIG_MISSING" }
        : { message };

    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (finalAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, finalAssetId!, errJson));
    }
    if (jobId && profileId) {
      if (cancelled) {
        await safe("cancelJob", () => cancelJob(profileId!, jobId!, errJson));
      } else {
        await safe("failJob", () => failJob(profileId!, jobId!, errJson));
      }
    }

    // Best-effort refund. Fires whenever a spend actually succeeded — covering
    // both failures AND user cancellations. InsufficientCreditsError returns 402
    // directly and never reaches this catch (creditsSpent stays false).
    if (creditsSpent && profileId && creditsAmount > 0 && jobType) {
      await safe("refundCredits", () =>
        refundCredits({
          profileId: profileId!,
          amount: creditsAmount,
          idempotencyKey: jobId
            ? `refund:${jobType}:${jobId}`
            : `refund:${jobType}:profile:${profileId}:${Date.now()}`,
          jobId: jobId ?? null,
          description: cancelled
            ? "Refund after user cancellation"
            : "Best-effort refund after generation failure",
          metadata: {
            reason: cancelled ? "generation_cancelled" : "generation_failed",
            originalError: errJson,
          },
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
      pricingMissing
        ? { error: message, code: "PRICING_CONFIG_MISSING" }
        : { error: message },
      { status: 500 }
    );
  }
}
