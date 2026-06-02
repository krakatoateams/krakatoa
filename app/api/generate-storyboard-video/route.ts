import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
import { getSessionUserId } from "@/lib/resolve-user";
import { getSupabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  videosStoryboardPath,
} from "@/lib/storage-buckets";
import { extractMediaUrl, runReplicateWithRetry } from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed, findStoryboardImageAsset } from "@/lib/assets-db";
import { createAssetRelation } from "@/lib/asset-relations-db";

export const maxDuration = 600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // Platform-observability trackers — declared before the try so the catch block
  // and post-job-creation early-return error paths can finalize them.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let videoAssetId: string | null = null;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[storyboard-video obs] ${label} failed:`, e);
      return null;
    }
  };

  // Best-effort fail-marking for early-return error paths after job creation.
  const failPlatform = async (message: string) => {
    const errJson = { message };
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
  };

  try {
    // Normal path: identity from the NextAuth session via the profile.
    //   profile.id      -> platform tables (jobs / job_steps / assets)
    //   profile.user_id -> legacy storyboards ownership + user_creations (= users.id)
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      // TEMPORARY SAFETY FALLBACK ONLY — must NOT become the normal path. On a
      // non-auth infrastructure error, keep legacy generation working but SKIP all
      // platform observability (profileId stays null -> guarded no-ops).
      console.warn("[storyboard-video obs] profile resolution failed for non-auth reasons — continuing legacy-only, platform observability skipped:", e);
      userId = await getSessionUserId();
      if (!userId) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
    }

    const body = await req.json();
    const storyboardId =
      typeof body.storyboardId === "string" ? body.storyboardId.trim() : "";

    if (!storyboardId || !UUID_RE.test(storyboardId)) {
      return NextResponse.json(
        { error: "storyboardId is required and must be a valid UUID." },
        { status: 400 }
      );
    }

    if (!process.env.REPLICATE_API_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 }
      );
    }

    const supabase = getSupabase();

    const { data: row, error: fetchError } = await supabase
      .from(STORYBOARDS_TABLE)
      .select("id, user_id, theme, storyboard_url, seedance_prompt")
      .eq("id", storyboardId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { error: fetchError?.message || "Storyboard not found." },
        { status: 404 }
      );
    }

    if (row.user_id && row.user_id !== userId) {
      return NextResponse.json({ error: "Storyboard not found." }, { status: 404 });
    }

    const storyboardUrl = String(row.storyboard_url || "").trim();
    let seedancePrompt = String(row.seedance_prompt || "").trim();

    if (!storyboardUrl.startsWith("https://")) {
      return NextResponse.json(
        { error: "Stored storyboard_url is not a valid public https URL." },
        { status: 500 }
      );
    }
    if (!seedancePrompt) {
      return NextResponse.json(
        { error: "Stored seedance_prompt is empty." },
        { status: 500 }
      );
    }

    const { error: statusErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update({ status: "video_generating" })
      .eq("id", storyboardId);

    if (statusErr) {
      console.error("[Storyboard Video] status update:", statusErr);
      return NextResponse.json(
        { error: statusErr.message || "Failed to update status." },
        { status: 500 }
      );
    }

    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePrompt}`;
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // ---- Platform job + processing video asset (best-effort observability) ----
    // Created after all validation + ownership + status update so validation
    // early-returns never leave a dangling job.
    if (profileId) {
      const job = await safe("createJob", () => createJob({
        profileId: profileId!,
        tool: "storyboard",
        jobType: "storyboard_video",
        provider: "replicate",
        model: "bytedance/seedance-2.0-fast",
        input: { storyboardId },
      }));
      if (job) {
        jobId = job.id;
        await safe("startJob", () => startJob(profileId!, jobId!));
        const asset = await safe("createAsset", () => createProcessingAsset({
          profileId: profileId!,
          jobId: jobId!,
          tool: "storyboard",
          assetType: "video",
          role: "final_video",
          provider: "replicate",
          model: "bytedance/seedance-2.0-fast",
          metadata: { storyboardId },
        }));
        if (asset) videoAssetId = asset.id;
      }
    }

    const beginStep = async (stepKey: string, stepName: string, input?: Record<string, unknown>): Promise<void> => {
      if (!jobId || !profileId) return;
      const row = await safe(`beginStep:${stepKey}`, () => createJobStep({
        jobId: jobId!,
        profileId: profileId!,
        stepKey,
        stepName,
        status: "running",
        input,
      }));
      currentStepId = row?.id ?? null;
    };
    const endStep = async (output?: Record<string, unknown>): Promise<void> => {
      const id = currentStepId;
      currentStepId = null;
      if (id && profileId) {
        await safe("finishStep", () => finishJobStep(profileId!, id, output));
      }
    };

    await beginStep("video_generation", "Seedance video from storyboard reference");
    console.log("[Storyboard Video] Calling Seedance (15s, 16:9, audio, reference)...");
    const videoResult = await runReplicateWithRetry(
      replicate,
      "bytedance/seedance-2.0-fast",
      {
        input: {
          prompt: seedancePrompt,
          reference_images: [storyboardUrl],
          duration: 15,
          generate_audio: true,
          resolution: "720p",
          aspect_ratio: "16:9",
        },
      }
    );

    const videoRemoteUrl = extractMediaUrl(videoResult);
    if (!videoRemoteUrl || !videoRemoteUrl.startsWith("http")) {
      console.error("[Storyboard Video] Bad Seedance output:", videoResult);
      await failPlatform("Failed to resolve video URL from Seedance output.");
      return NextResponse.json(
        { error: "Failed to resolve video URL from Seedance output." },
        { status: 500 }
      );
    }
    await endStep({ videoRemoteUrl });

    await beginStep("storage_upload", "Download Seedance MP4 + upload to Supabase");
    console.log("[Storyboard Video] Downloading MP4...");
    const vidRes = await fetch(videoRemoteUrl);
    if (!vidRes.ok) {
      throw new Error(
        `Failed to download video: ${vidRes.status} ${vidRes.statusText}`
      );
    }
    const videoBuffer = await vidRes.arrayBuffer();

    const filename = `video_${Date.now()}.mp4`;
    const storagePath = videosStoryboardPath(filename);

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, videoBuffer, {
        contentType: "video/mp4",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("[Storyboard Video] Upload error:", uploadError);
      await failPlatform(`Failed to upload video: ${uploadError.message}`);
      return NextResponse.json(
        { error: `Failed to upload video: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl: videoUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    await endStep({ storagePath, publicUrl: videoUrl });

    const { error: finalErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update({ video_url: videoUrl, status: "done" })
      .eq("id", storyboardId);

    if (finalErr) {
      console.error("[Storyboard Video] Final DB update:", finalErr);
      await failPlatform(finalErr.message || "Video uploaded but failed to update record.");
      return NextResponse.json(
        { error: finalErr.message || "Video uploaded but failed to update record." },
        { status: 500 }
      );
    }

    console.log("[Storyboard Video] Done:", videoUrl);

    // Mark the final video asset ready, then best-effort link it back to its
    // source storyboard image via asset_relations (storyboard_for).
    if (videoAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, videoAssetId!, {
        storagePath,
        publicUrl: videoUrl,
        mimeType: "video/mp4",
        durationSec: 15,
        width: 1280,
        height: 720,
        metadata: { storyboardId },
      }));

      const imageAsset = await safe("findStoryboardImageAsset", () =>
        findStoryboardImageAsset(profileId!, storyboardId)
      );
      if (imageAsset) {
        await safe("createAssetRelation", () => createAssetRelation({
          profileId: profileId!,
          parentAssetId: imageAsset.id,
          childAssetId: videoAssetId!,
          relationType: "storyboard_for",
          metadata: { storyboardId },
        }));
      }
    }

    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { videoUrl, storagePath, assetId: videoAssetId, storyboardId },
      }));
    }

    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: "storyboard_video",
        mediaType: "video",
        mediaUrl: videoUrl,
        storagePath,
        title: String(row.theme || "Storyboard video").slice(0, 200),
        metadata: { storyboardId },
      });
    } catch (historyErr) {
      console.warn("[Storyboard Video] History log failed:", historyErr);
    }

    return NextResponse.json({ videoUrl, historyItem });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[Storyboard Video] Error:", error);
    // Best-effort failure marking — must not throw or mask the original error.
    const errJson = { message };
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
