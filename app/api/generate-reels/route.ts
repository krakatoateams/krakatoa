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
import { getCurrentAdmin } from "@/lib/admin-auth";
import { insertUserCreation } from "@/lib/creations-db";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { finishJob, markJobRecoverable } from "@/lib/jobs-db";
import { createJobStep, finishJobStep } from "@/lib/job-steps-db";
import {
  beginMeteredAttempt,
  finishMeteredAttempt,
  type MeteredAttemptHandle,
} from "@/lib/metered-generation/lifecycle";
import {
  markAssetReady,
} from "@/lib/assets-db";
import { isCancellation } from "@/lib/replicate-server";
import { makeReplicateCancelHooks, isCancelRequested, assertNotCancelled } from "@/lib/generation-cancel";
import { markProviderCommitted, isRefundableUserCancellation } from "@/lib/generation-commit";
import { createPipelineRecoveryHandle } from "@/lib/pipeline-recovery/handle";
import { isRecoverablePipelineError } from "@/lib/pipeline-recovery/errors";
import { getSeedanceCredits, getVeoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getReelsModels, getVeoModels, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { createReplicateClient } from "@/lib/replicate-utils";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
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
  ReelsModelRefs,
  ReelsPipelineContext,
  ReelsPipelineResult,
} from "@/lib/reels-pipeline/types";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
} from "@/lib/storage-buckets";
import { signStoragePathForUser } from "@/lib/storage-signed-url";
import {
  DevBlankForbiddenError,
  devBlankJobTag,
  isDevBlankRequested,
  readBlankVideoBytes,
  requireDevBlankAccess,
} from "@/lib/dev-blank-generation";

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
  let metered: MeteredAttemptHandle | null = null;
  // Credit-spend trackers. `creditsSpent` is the gate; without it the catch
  // block must NOT refund (no spend = no debt). `jobType` keys the refund.
  let creditsSpent = false;
  let creditsAmount = 0;
  let jobType: "reels_seedance" | "veo_single" | "veo_perscene" | null = null;
  let pipelineRecovery: ReturnType<typeof createPipelineRecoveryHandle> | undefined;

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

    // Reels Creator is admin-only until public launch — gate the API, not just the UI.
    const admin = await getCurrentAdmin();
    if (!admin) {
      return NextResponse.json(
        { error: "Reels Creator is coming soon.", code: "FEATURE_NOT_AVAILABLE" },
        { status: 403 }
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
    const devBlank = isDevBlankRequested(body);
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
    let models: ReelsModelSet | undefined;
    let refs: ReelsModelRefs | undefined;
    if (!devBlank) {
      const replicate = createReplicateClient(); // throws if REPLICATE_API_TOKEN missing
      const rendiApiKey = process.env.RENDI_API_KEY;
      if (!rendiApiKey) {
        return NextResponse.json({ error: "RENDI_API_KEY is not set." }, { status: 500 });
      }

      // ---- Resolve runtime models (Admin Phase 2) ----
      // Seedance resolves the 'reels' tool config; Veo resolves the 'veo' tool
      // config — preserving the existing model_configs layout (no DB migration).
      models = reqv.engine === "veo" ? await getVeoModels() : await getReelsModels();
      refs = {
        llmRef: replicateRef(models.llm),
        videoRef: replicateRef(models.video),
        ttsRef: replicateRef(models.tts),
        whisperRef: replicateRef(models.whisper),
      };
      void replicate;
      void rendiApiKey;
    }

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
    const jobInput: Record<string, unknown> =
      reqv.engine === "seedance"
        ? {
            engine: "seedance",
            userId: userId!,
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
            userId: userId!,
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
    const requiredCredits = devBlank
      ? 0
      : reqv.engine === "veo"
        ? await getVeoCredits({ resolution: reqv.resolution, durationSec: reqv.totalDuration })
        : await getSeedanceCredits({ resolution: reqv.resolution, durationSec: reqv.totalDuration });
    const beginResult = await beginMeteredAttempt({
      profileId: profileId!,
      userId,
      idempotency: {
        key: idemKey,
        routeKey: "generate_reels",
        toolKey: "reels",
        requestHash,
      },
      job: {
        tool: reqv.jobTool,
        jobType: reqv.jobType,
        provider: devBlank ? "dev_blank" : models!.video.provider,
        model: devBlank ? "dev_blank" : models!.video.model,
        input: {
          ...jobInput,
          ...(devBlank ? devBlankJobTag() : {}),
        },
      },
      spend: {
        amount: requiredCredits,
        jobType: reqv.jobType,
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
        skip: devBlank,
      },
      processingAssets: [
        {
          tool: reqv.jobTool,
          assetType: "video",
          role: "final_video",
          provider: devBlank ? "dev_blank" : models!.video.provider,
          model: devBlank ? "dev_blank" : models!.video.model,
          metadata: {
            theme: reqv.theme.slice(0, 200),
            engine: reqv.engine,
            ...(reqv.engine === "veo" ? { mode: reqv.mode } : {}),
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
    finalAssetId = metered.assetIds[0] ?? null;

    if (devBlank) {
      await beginStep("dev_blank", "Deliver blank placeholder video (admin test)");
      const videoBuffer = await readBlankVideoBytes("9:16");
      const storagePath = videosGeneratedVideoPath(
        userId!,
        "reelscreator",
        `video_${Date.now()}.mp4`,
      );
      const { error: uploadError } = await supabaseServer.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, videoBuffer, {
          contentType: "video/mp4",
          cacheControl: MEDIA_CACHE_CONTROL,
          upsert: false,
        });
      if (uploadError) {
        throw new Error(`Failed to save blank video to storage: ${uploadError.message}`);
      }
      const { url: videoUrl } = await signStoragePathForUser(storagePath, userId!, "ui");
      await endStep({ storagePath, publicUrl: videoUrl });

      const blankResult = {
        videoUrl,
        storagePath,
        durationSec: reqv.totalDuration,
        width: 480,
        height: 854,
        scenePrompts: [] as string[],
        narration: "",
      };

      if (finalAssetId && profileId) {
        await safe("markAssetReady", () =>
          markAssetReady(profileId!, finalAssetId!, {
            storagePath,
            mimeType: "video/mp4",
            durationSec: blankResult.durationSec,
            width: blankResult.width,
            height: blankResult.height,
            costCredits: creditsAmount,
            metadata: {
              engine: reqv.engine,
              ...(devBlank ? devBlankJobTag() : {}),
            },
          }),
        );
      }

      let historyItem;
      try {
        historyItem = await insertUserCreation({
          userId: userId as string,
          tool: reqv.creationTool,
          mediaType: "video",
          mediaUrl: storagePath,
          storagePath,
          title: reqv.theme.slice(0, 200),
          metadata: {
            engine: reqv.engine,
            modelLabel: "Dev blank",
            prompt: reqv.theme,
            ...(devBlank ? devBlankJobTag() : {}),
          },
        });
      } catch (historyErr) {
        console.warn("[reels] History log failed (video still saved):", historyErr);
      }

      if (jobId && profileId) {
        await safe("finishJob", () =>
          finishJob(profileId!, jobId!, {
            output: {
              videoUrl,
              storagePath,
              assetId: finalAssetId,
            },
            costCredits: creditsAmount,
          }),
        );
      }

      const successResponse = {
        videoUrl: blankResult.videoUrl,
        storagePath: blankResult.storagePath,
        historyItem,
      };
      await finishMeteredAttempt(metered, {
        kind: "success",
        responseJson: successResponse,
        primaryAssetId: finalAssetId,
      });
      return NextResponse.json(successResponse);
    }

    const pipelineModels = models!;
    const pipelineRefs = refs!;

    pipelineRecovery =
      jobId && profileId && userId
        ? createPipelineRecoveryHandle({
            profileId: profileId!,
            userId: userId!,
            jobId: jobId!,
          })
        : undefined;
    const recovery = pipelineRecovery;

    // ---- Build the pipeline context + dispatch ----
    const ctx: ReelsPipelineContext = {
      replicate: createReplicateClient(),
      userId: userId!,
      rendiApiKey: process.env.RENDI_API_KEY!,
      models: pipelineModels,
      refs: pipelineRefs,
      log: { beginStep, endStep },
      isCancelled: async () =>
        generationRequestId && profileId
          ? isCancelRequested(profileId, generationRequestId)
          : false,
      recorder:
        makeReplicateCancelHooks({
          generationRequestId,
          profileId,
          jobId,
          kind: reqv.jobType,
        }) ?? {},
      onProviderCommitted:
        generationRequestId && profileId
          ? () =>
              markProviderCommitted({
                generationRequestId: generationRequestId!,
                profileId: profileId!,
                reason: "reels_first_scene_or_veo_clip",
              })
          : undefined,
      recovery,
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

    // Defense-in-depth: honor cancel that landed during the final pipeline steps.
    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    // ---- Finalize (asset -> history -> job -> usage -> idempotency) ----
    // costCredits on the asset/job is a display snapshot only; the ledger row
    // created by spendCredits is the billing source of truth.
    if (finalAssetId && profileId) {
      await safe("markAssetReady", () =>
        markAssetReady(profileId!, finalAssetId!, {
          storagePath: result.storagePath,
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
                  llmModel: pipelineModels.llm.model,
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
        mediaUrl: result.storagePath,
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
    const successResponse = { videoUrl: result.videoUrl, storagePath: result.storagePath, historyItem };
    await finishMeteredAttempt(metered!, {
      kind: "success",
      responseJson: successResponse,
      primaryAssetId: finalAssetId,
      usage: {
        assetId: finalAssetId,
        tool: reqv.jobTool,
        provider: pipelineModels.video.provider,
        model: pipelineModels.video.model,
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
      },
      purgeResumable: true,
    });
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const recoverable = isRecoverablePipelineError(error);
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    const pricingMissing = error instanceof PricingConfigError;
    const rawMessage =
      error instanceof Error ? error.message : String(error);
    if (cancelled) console.log("[reels] Cancelled by user.");
    else if (recoverable) console.warn("[reels] Recoverable pipeline error:", error);
    else console.error("[reels] pipeline error:", error);
    const handle =
      metered ??
      (profileId
        ? {
            profileId,
            userId,
            jobId,
            generationRequestId,
            creditsSpent,
            creditsAmount,
            assetIds: finalAssetId ? [finalAssetId] : [],
            refundJobType: jobType ?? "",
          }
        : null);
    if (handle) {
      if (finalAssetId) handle.assetIds = [finalAssetId];
      const finished = await finishMeteredAttempt(
        handle,
        recoverable
          ? {
              kind: "recoverable",
              rawMessage,
              currentStepId,
              clearCurrentStep: () => {
                currentStepId = null;
              },
              settlementOptions: {
                recoverableJobAction: "mark_recoverable",
                resumablePurge: true,
                requireJobTypeForRefund: true,
              },
              settlementLegacyOpts: {
                markRecoverableJob: async ({ profileId: pid, jobId: jid, errJson }) => {
                  const manifest = pipelineRecovery?.getManifest();
                  await markJobRecoverable(pid, jid, {
                    recovery: (manifest ?? {}) as unknown as Record<string, unknown>,
                    outputExtra: finalAssetId ? { assetId: finalAssetId } : undefined,
                    error: errJson,
                  });
                },
              },
            }
          : {
              kind: "terminal",
              cancelled,
              pricingMissing,
              rawMessage,
              currentStepId,
              clearCurrentStep: () => {
                currentStepId = null;
              },
              settlementOptions: {
                resumablePurge: true,
                requireJobTypeForRefund: true,
              },
            },
      );
      if (finished.http) {
        return NextResponse.json(finished.http.body, { status: finished.http.status });
      }
    }
    return NextResponse.json({ error: rawMessage }, { status: 500 });
  }
}
