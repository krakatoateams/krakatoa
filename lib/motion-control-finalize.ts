import { insertUserCreation } from "@/lib/creations-db";
import { finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { markAssetReady, markAssetFailed } from "@/lib/assets-db";
import { refundCredits } from "@/lib/credits-db";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, videosGeneratedVideoPath } from "@/lib/storage-buckets";
import { signStoragePathForUser } from "@/lib/storage-signed-url";
import {
  finishGenerationRequestFailure,
  finishGenerationRequestSuccess,
} from "@/lib/generation-idempotency";
import {
  getMotionControlModel,
  motionControlResolutionLabel,
  type MotionControlMode,
  type CharacterOrientation,
} from "@/lib/motion-control-models";

export type MotionControlSuccessResponse = {
  videoUrl: string;
  storagePath: string;
  historyItem: Awaited<ReturnType<typeof insertUserCreation>> | null;
  savedToCloud: true;
};

export type MotionControlFinalizeContext = {
  profileId: string;
  userId: string;
  jobId: string | null;
  videoAssetId: string | null;
  generationRequestId: string | null;
  creditsAmount: number;
  prompt: string;
  modelId: string;
  mode: MotionControlMode;
  characterOrientation: CharacterOrientation;
  keepOriginalSound: boolean;
  billedDuration: number;
  pricingKey: string;
  provider: string;
  providerModel: string;
  tempRefPaths?: string[];
};

const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[motion-control finalize] ${label} failed:`, e);
    return null;
  }
};

export async function cleanupMotionControlTempRefs(paths: string[] | undefined): Promise<void> {
  if (!paths?.length) return;
  try {
    await supabaseServer.storage.from(STORAGE_BUCKET).remove(paths);
  } catch (e) {
    console.warn("[motion-control] temp reference cleanup failed:", e);
  }
}

export async function finalizeMotionControlSuccess(
  ctx: MotionControlFinalizeContext,
  generatedVideoUrl: string,
): Promise<MotionControlSuccessResponse> {
  const model = getMotionControlModel(ctx.modelId);
  const resolutionLabel = motionControlResolutionLabel(ctx.mode);
  const creationMetadata = {
    prompt: ctx.prompt,
    modelId: ctx.modelId,
    modelLabel: model.modelLabel,
    providerModel: ctx.providerModel,
    mode: ctx.mode,
    resolution: resolutionLabel,
    characterOrientation: ctx.characterOrientation,
    keepOriginalSound: ctx.keepOriginalSound,
    billedDuration: ctx.billedDuration,
    pricingKey: ctx.pricingKey,
  };

  const videoResponse = await fetch(generatedVideoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
  }
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const storagePath = videosGeneratedVideoPath(
    ctx.userId,
    "motion-control",
    `video_${Date.now()}.mp4`,
  );

  const { error: uploadError } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, videoBuffer, { contentType: "video/mp4", upsert: false });
  if (uploadError) {
    throw new Error(`Failed to save video to storage: ${uploadError.message}`);
  }

  const { url: publicUrl } = await signStoragePathForUser(storagePath, ctx.userId, "ui");
  const title = ctx.prompt.slice(0, 60) || "Motion Control";

  const historyItem = await safe("insertUserCreation", () =>
    insertUserCreation({
      userId: ctx.userId,
      tool: "video_motion_control",
      mediaType: "video",
      mediaUrl: storagePath,
      storagePath,
      title,
      metadata: creationMetadata,
    }),
  );

  if (ctx.videoAssetId) {
    await safe("markAssetReady", () =>
      markAssetReady(ctx.profileId, ctx.videoAssetId!, {
        storagePath,
        mimeType: "video/mp4",
        durationSec: ctx.billedDuration,
        costCredits: ctx.creditsAmount,
        metadata: creationMetadata,
      }),
    );
  }
  if (ctx.jobId) {
    await safe("finishJob", () =>
      finishJob(ctx.profileId, ctx.jobId!, {
        output: { videoUrl: publicUrl, storagePath, assetId: ctx.videoAssetId },
        costCredits: ctx.creditsAmount,
      }),
    );
  }

  await safe("recordUsage", () =>
    recordUsageEvent({
      profileId: ctx.profileId,
      jobId: ctx.jobId ?? null,
      assetId: ctx.videoAssetId ?? null,
      tool: "reels",
      provider: ctx.provider,
      model: ctx.providerModel,
      unitType: "video_seconds",
      units: ctx.billedDuration,
      creditsCharged: ctx.creditsAmount,
      metadata: { jobType: "video_motion_control", modelId: ctx.modelId, mode: ctx.mode, pricingKey: ctx.pricingKey },
    }),
  );

  const successResponse: MotionControlSuccessResponse = {
    videoUrl: publicUrl,
    storagePath,
    historyItem,
    savedToCloud: true,
  };

  if (ctx.generationRequestId) {
    await safe("idemSuccess", () =>
      finishGenerationRequestSuccess({
        id: ctx.generationRequestId!,
        jobId: ctx.jobId ?? null,
        assetId: ctx.videoAssetId ?? null,
        responseJson: successResponse,
      }),
    );
  }

  await cleanupMotionControlTempRefs(ctx.tempRefPaths);
  return successResponse;
}

export async function failMotionControlAttempt(
  ctx: MotionControlFinalizeContext,
  errJson: Record<string, unknown>,
  options: { cancelled?: boolean; refund?: boolean } = {},
): Promise<void> {
  const cancelled = options.cancelled === true;
  const refund = options.refund !== false;

  if (ctx.jobId) {
    if (cancelled) {
      await safe("cancelJob", () => cancelJob(ctx.profileId, ctx.jobId!, errJson));
    } else {
      await safe("failJob", () => failJob(ctx.profileId, ctx.jobId!, errJson));
    }
  }
  if (ctx.videoAssetId) {
    await safe("failAsset", () => markAssetFailed(ctx.profileId, ctx.videoAssetId!, errJson));
  }
  if (refund && ctx.creditsAmount > 0) {
    await safe("refundCredits", () =>
      refundCredits({
        profileId: ctx.profileId,
        amount: ctx.creditsAmount,
        idempotencyKey: ctx.jobId
          ? `refund:video_motion_control:${ctx.jobId}`
          : `refund:video_motion_control:profile:${ctx.profileId}:${Date.now()}`,
        jobId: ctx.jobId ?? null,
        description: cancelled
          ? "Refund after user cancellation"
          : "Best-effort refund after generation failure",
        metadata: {
          reason: cancelled ? "generation_cancelled" : "generation_failed",
          originalError: errJson,
        },
      }),
    );
  }
  if (ctx.generationRequestId) {
    await safe("idemFailure", () =>
      finishGenerationRequestFailure({
        id: ctx.generationRequestId!,
        jobId: ctx.jobId ?? null,
        errorJson: errJson,
      }),
    );
  }
  await cleanupMotionControlTempRefs(ctx.tempRefPaths);
}

export async function endMotionControlStep(
  profileId: string,
  stepId: string | null,
  output?: Record<string, unknown>,
): Promise<void> {
  if (!stepId) return;
  await safe("finishStep", () => finishJobStep(profileId, stepId, output));
}

export async function failMotionControlStep(
  profileId: string,
  stepId: string | null,
  errJson: Record<string, unknown>,
): Promise<void> {
  if (!stepId) return;
  await safe("failStep", () => failJobStep(profileId, stepId, errJson));
}
