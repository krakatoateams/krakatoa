import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
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
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { estimateStoryboardVideoCredits } from "@/lib/credit-costs";
import { recordUsageEvent } from "@/lib/usage-events-db";

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
  // Credit-spend trackers — see app/api/generate/route.ts for the pattern.
  let creditsSpent = false;
  let creditsAmount = 0;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[storyboard-video obs] ${label} failed:`, e);
      return null;
    }
  };

  try {
    // STRICT profile resolution — this route now charges credits.
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
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
      console.error("[storyboard-video] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
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

    // NOTE: storyboards.status update moved to AFTER the credit spend so an
    // insufficient-credits return cannot leave the storyboard stuck in
    // 'video_generating'. The status remains whatever it was on the
    // insufficient-credits / pre-spend infra-failure paths.

    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePrompt}`;
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // ---- Platform job (best-effort observability) ----
    // Asset creation is deferred until after the credit spend succeeds.
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
    }

    // ---- Credit spend (BUSINESS LOGIC — not safe-wrapped) ----
    // Storyboard video is a flat 30 credits. Insufficient → 402 with no
    // provider call, no storyboards.status mutation, no processing asset.
    const requiredCredits = estimateStoryboardVideoCredits();
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:storyboard_video:${jobId}`
          : `spend:storyboard_video:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Storyboard video generation",
        metadata: {
          tool: "storyboard",
          jobType: "storyboard_video",
          storyboardId,
        },
      });
      creditsSpent = true;
      creditsAmount = requiredCredits;
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        const wallet = await getWallet(profileId!).catch(() => null);
        const currentBalance = wallet?.balance ?? 0;
        if (jobId) {
          await safe("failJobInsufficient", () => failJob(profileId!, jobId!, {
            code: "INSUFFICIENT_CREDITS",
            message: "Insufficient credits.",
            requiredCredits,
            currentBalance,
          }));
        }
        return NextResponse.json(
          { error: "Insufficient credits.", requiredCredits, currentBalance },
          { status: 402 }
        );
      }
      throw e;
    }

    // ---- Storyboard status + processing asset (created AFTER spend succeeds) ----
    const { error: statusErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update({ status: "video_generating" })
      .eq("id", storyboardId);
    if (statusErr) {
      console.error("[Storyboard Video] status update:", statusErr);
      throw new Error(statusErr.message || "Failed to update status.");
    }

    const asset = await safe("createAsset", () => createProcessingAsset({
      profileId: profileId!,
      jobId: jobId ?? undefined,
      tool: "storyboard",
      assetType: "video",
      role: "final_video",
      provider: "replicate",
      model: "bytedance/seedance-2.0-fast",
      metadata: { storyboardId },
    }));
    if (asset) videoAssetId = asset.id;

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
      throw new Error("Failed to resolve video URL from Seedance output.");
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
      throw new Error(`Failed to upload video: ${uploadError.message}`);
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
      throw new Error(finalErr.message || "Video uploaded but failed to update record.");
    }

    console.log("[Storyboard Video] Done:", videoUrl);

    // Mark the final video asset ready, then best-effort link it back to its
    // source storyboard image via asset_relations (storyboard_for).
    // costCredits on both markAssetReady and finishJob is a display snapshot —
    // credit_transactions is the billing source of truth.
    if (videoAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, videoAssetId!, {
        storagePath,
        publicUrl: videoUrl,
        mimeType: "video/mp4",
        durationSec: 15,
        width: 1280,
        height: 720,
        costCredits: creditsAmount,
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
        costCredits: creditsAmount,
      }));
    }

    // Usage event — analytics only, NEVER affects billing/response.
    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: videoAssetId ?? null,
      tool: "storyboard",
      provider: "replicate",
      model: "bytedance/seedance-2.0-fast",
      unitType: "video_seconds",
      units: 15,
      creditsCharged: creditsAmount,
      metadata: { jobType: "storyboard_video", storyboardId },
    }));

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

    // Best-effort refund. Only fires when spendCredits actually succeeded.
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:storyboard_video:${jobId}`
          : `refund:storyboard_video:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Best-effort refund after generation failure",
        metadata: { reason: "generation_failed", originalError: errJson },
      }));
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
