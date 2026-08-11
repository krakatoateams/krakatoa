import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  getJob,
  resumeJobRunning,
  finishJob,
  markJobRecoverable,
  updateJobRecoveryOutput,
} from "@/lib/jobs-db";
import {
  markAssetReady,
  findStoryboardImageAsset,
} from "@/lib/assets-db";
import { createAssetRelation } from "@/lib/asset-relations-db";
import { purgeResumableJobStorage } from "@/lib/pipeline-recovery/storage";
import {
  parseRecoveryManifest,
  mergeManifest,
  MAX_RESUME_ATTEMPTS,
} from "@/lib/pipeline-recovery/manifest";
import { resumeReelsFromManifest } from "@/lib/pipeline-recovery/resume-reels";
import { resumeVideoUploadFromManifest } from "@/lib/pipeline-recovery/resume-video-upload";
import { closeRecoverableJobTerminal } from "@/lib/pipeline-recovery/failure";
import { isRecoverablePipelineError } from "@/lib/pipeline-recovery/errors";
import { insertUserCreation } from "@/lib/creations-db";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  videosGeneratedVideoPath,
  videosStoryboardVideoPath,
} from "@/lib/storage-buckets";
import { signStoragePathForUser } from "@/lib/storage-signed-url";
import { storyboardVideoDimensions } from "@/lib/storyboard-style";
import {
  finishGenerationRequestsForJobSuccess,
  finishGenerationRequestsForJob,
} from "@/lib/generation-idempotency";

export const maxDuration = 300;

const PIPELINE_RECOVERABLE = "PIPELINE_RECOVERABLE";

async function closeResumeSuccess(params: {
  profileId: string;
  jobId: string;
  assetId?: string;
  responseJson: Record<string, unknown>;
}): Promise<void> {
  await finishGenerationRequestsForJobSuccess({
    profileId: params.profileId,
    jobId: params.jobId,
    responseJson: params.responseJson,
    assetId: params.assetId ?? null,
  });
}

async function revertToRecoverable(
  profileId: string,
  jobId: string,
  manifest: ReturnType<typeof parseRecoveryManifest>,
  message: string,
): Promise<void> {
  if (!manifest) return;
  await markJobRecoverable(profileId, jobId, {
    recovery: manifest as unknown as Record<string, unknown>,
    error: { code: PIPELINE_RECOVERABLE, message },
  });
}

/**
 * POST /api/generations/resume
 * Resume a recoverable generation job from stored resumable artifacts.
 * Body: { jobId: string }
 */
export async function POST(req: Request) {
  let profileId: string;
  let userId: string;
  try {
    const profile = await requireCurrentProfile();
    profileId = profile.id;
    userId = profile.user_id;
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    return NextResponse.json({ error: "Profile resolution failed." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const jobId = body && typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await getJob(profileId, jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.status !== "recoverable") {
    return NextResponse.json(
      { error: "Job is not recoverable.", status: job.status },
      { status: 409 },
    );
  }

  const manifest = parseRecoveryManifest(job.output);
  if (!manifest) {
    return NextResponse.json({ error: "Recovery manifest missing." }, { status: 500 });
  }

  const attempts = manifest.resumeAttempts ?? 0;
  if (attempts >= MAX_RESUME_ATTEMPTS) {
    await closeRecoverableJobTerminal({
      profileId,
      userId,
      jobId,
      jobType: job.job_type,
      creditsAmount: job.cost_credits,
      reason: "resume_exhausted",
      code: "RESUME_EXHAUSTED",
      message: "Maximum resume attempts exceeded.",
    });
    await finishGenerationRequestsForJob({
      profileId,
      jobId,
      errorJson: {
        code: "RESUME_EXHAUSTED",
        message: "Maximum resume attempts exceeded.",
      },
    });
    return NextResponse.json(
      { error: "Maximum resume attempts exceeded.", code: "RESUME_EXHAUSTED" },
      { status: 409 },
    );
  }

  const resumed = await resumeJobRunning(profileId, jobId);
  if (!resumed) {
    return NextResponse.json({ error: "Could not resume job." }, { status: 409 });
  }

  const pipeline = manifest.pipeline;
  const needsRendi =
    pipeline === "reels_seedance" ||
    pipeline === "reels_veo_single" ||
    pipeline === "reels_veo_per_scene";

  if (needsRendi && !process.env.RENDI_API_KEY?.trim()) {
    await revertToRecoverable(profileId, jobId, manifest, "RENDI_API_KEY is not set.");
    return NextResponse.json({ error: "RENDI_API_KEY is not set." }, { status: 500 });
  }

  const bumped = mergeManifest(manifest, { resumeAttempts: attempts + 1 });
  await updateJobRecoveryOutput(profileId, jobId, bumped as unknown as Record<string, unknown>);

  try {
    if (needsRendi) {
      const result = await resumeReelsFromManifest({
        userId,
        manifest: bumped,
      });

      const assetId =
        typeof job.output?.assetId === "string" ? job.output.assetId : undefined;

      if (assetId) {
        await markAssetReady(profileId, assetId, {
          storagePath: result.storagePath,
          mimeType: "video/mp4",
          durationSec: result.durationSec,
          width: result.width,
          height: result.height,
          costCredits: job.cost_credits,
        });
      }

      await finishJob(profileId, jobId, {
        output: {
          videoUrl: result.videoUrl,
          storagePath: result.storagePath,
          assetId,
        },
        costCredits: job.cost_credits,
      });

      await purgeResumableJobStorage(userId, jobId);

      try {
        await insertUserCreation({
          userId,
          tool: job.tool as "reels_seedance",
          mediaType: "video",
          mediaUrl: result.storagePath,
          storagePath: result.storagePath,
          title: String(job.input?.theme ?? "Resumed video").slice(0, 200),
          metadata: { resumed: true, jobId },
        });
      } catch {
        // non-fatal
      }

      const successResponse = {
        videoUrl: result.videoUrl,
        storagePath: result.storagePath,
        resumed: true,
      };
      await closeResumeSuccess({
        profileId,
        jobId,
        assetId,
        responseJson: successResponse,
      });

      return NextResponse.json(successResponse);
    }

    if (pipeline === "video" || pipeline === "storyboard_video") {
      const uploadResult = await resumeVideoUploadFromManifest({
        userId,
        manifest: bumped,
        upload: async (buffer, filename) => {
          if (pipeline === "storyboard_video") {
            const storagePath = videosStoryboardVideoPath(userId, filename);
            const { error: uploadError } = await supabaseServer.storage
              .from(STORAGE_BUCKET)
              .upload(storagePath, Buffer.from(buffer), {
                contentType: "video/mp4",
                cacheControl: MEDIA_CACHE_CONTROL,
                upsert: false,
              });
            if (uploadError) {
              throw new Error(`Failed to save video to storage: ${uploadError.message}`);
            }
            const { url: publicUrl } = await signStoragePathForUser(storagePath, userId, "ui");
            return { storagePath, publicUrl };
          }

          const jobKind = job.job_type;
          const videoMode = jobKind === "video_image2video" ? "i2v" : "t2v";
          const storagePath = videosGeneratedVideoPath(userId, videoMode, filename);
          const { error: uploadError } = await supabaseServer.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, Buffer.from(buffer), {
              contentType: "video/mp4",
              cacheControl: MEDIA_CACHE_CONTROL,
              upsert: false,
            });
          if (uploadError) {
            throw new Error(`Failed to save video to storage: ${uploadError.message}`);
          }
          const { url: publicUrl } = await signStoragePathForUser(storagePath, userId, "ui");
          return { storagePath, publicUrl };
        },
      });

      const assetId =
        typeof job.output?.assetId === "string" ? job.output.assetId : undefined;

      if (pipeline === "storyboard_video") {
        const storyboardId =
          typeof job.input?.storyboardId === "string" ? job.input.storyboardId : "";
        const resolution =
          job.input?.resolution === "720p" ? "720p" : "480p";
        const aspectRatio = (job.input?.aspectRatio as "16:9" | "9:16") ?? "16:9";
        const durationSec =
          typeof job.input?.durationSec === "number" ? job.input.durationSec : 15;

        if (storyboardId) {
          const { error: finalErr } = await supabaseServer
            .from(STORYBOARDS_TABLE)
            .update({ video_url: uploadResult.storagePath, status: "done" })
            .eq("id", storyboardId);
          if (finalErr) {
            throw new Error(finalErr.message || "Video uploaded but failed to update storyboard.");
          }
        }

        if (assetId) {
          const dims = storyboardVideoDimensions(resolution, aspectRatio);
          await markAssetReady(profileId, assetId, {
            storagePath: uploadResult.storagePath,
            mimeType: "video/mp4",
            durationSec,
            width: dims.width,
            height: dims.height,
            costCredits: job.cost_credits,
            metadata: {
              storyboardId,
              videoModelId: job.input?.videoModelId,
              resolution,
              durationSec,
              aspectRatio,
            },
          });

          if (storyboardId) {
            const imageAsset = await findStoryboardImageAsset(profileId, storyboardId);
            if (imageAsset) {
              await createAssetRelation({
                profileId,
                parentAssetId: imageAsset.id,
                childAssetId: assetId,
                relationType: "storyboard_for",
                metadata: { storyboardId },
              });
            }
          }
        }

        await finishJob(profileId, jobId, {
          output: {
            videoUrl: uploadResult.publicUrl,
            storagePath: uploadResult.storagePath,
            assetId,
            storyboardId,
          },
          costCredits: job.cost_credits,
        });

        await purgeResumableJobStorage(userId, jobId);

        try {
          await insertUserCreation({
            userId,
            tool: "storyboard_video",
            mediaType: "video",
            mediaUrl: uploadResult.storagePath,
            storagePath: uploadResult.storagePath,
            title: "Storyboard video",
            metadata: { resumed: true, jobId, storyboardId },
          });
        } catch {
          // non-fatal
        }

        const successResponse = {
          videoUrl: uploadResult.publicUrl,
          storagePath: uploadResult.storagePath,
          resumed: true,
        };
        await closeResumeSuccess({
          profileId,
          jobId,
          assetId,
          responseJson: successResponse,
        });

        return NextResponse.json(successResponse);
      }

      const duration =
        typeof job.input?.duration === "number" ? job.input.duration : undefined;

      if (assetId) {
        await markAssetReady(profileId, assetId, {
          storagePath: uploadResult.storagePath,
          mimeType: "video/mp4",
          durationSec: duration,
          costCredits: job.cost_credits,
        });
      }

      await finishJob(profileId, jobId, {
        output: {
          videoUrl: uploadResult.publicUrl,
          storagePath: uploadResult.storagePath,
          assetId,
        },
        costCredits: job.cost_credits,
      });

      await purgeResumableJobStorage(userId, jobId);

      try {
        await insertUserCreation({
          userId,
          tool: job.job_type as "video_text2video",
          mediaType: "video",
          mediaUrl: uploadResult.storagePath,
          storagePath: uploadResult.storagePath,
          title: String(job.input?.modelId ?? "Resumed video").slice(0, 200),
          metadata: { resumed: true, jobId },
        });
      } catch {
        // non-fatal
      }

      const successResponse = {
        videoUrl: uploadResult.publicUrl,
        storagePath: uploadResult.storagePath,
        resumed: true,
      };
      await closeResumeSuccess({
        profileId,
        jobId,
        assetId,
        responseJson: successResponse,
      });

      return NextResponse.json(successResponse);
    }

    await revertToRecoverable(
      profileId,
      jobId,
      bumped,
      "Resume not implemented for this pipeline.",
    );
    return NextResponse.json(
      { error: "Resume not implemented for this pipeline.", pipeline },
      { status: 501 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRecoverablePipelineError(error)) {
      await markJobRecoverable(profileId, jobId, {
        recovery: mergeManifest(bumped, {
          lastError: { code: PIPELINE_RECOVERABLE, message },
        }) as unknown as Record<string, unknown>,
        error: { code: PIPELINE_RECOVERABLE, message },
      });
      return NextResponse.json(
        { recoverable: true, jobId, error: message, code: PIPELINE_RECOVERABLE },
        { status: 503 },
      );
    }

    await closeRecoverableJobTerminal({
      profileId,
      userId,
      jobId,
      jobType: job.job_type,
      creditsAmount: job.cost_credits,
      reason: "terminal_delivery_failure",
      code: "DELIVERY_FAILED",
      message,
    });
    await finishGenerationRequestsForJob({
      profileId,
      jobId,
      errorJson: { message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
