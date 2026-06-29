import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
import { getSupabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  videosStoryboardPath,
} from "@/lib/storage-buckets";
import { extractMediaUrl, runReplicateWithRetry, isCancellation, ReplicateCancellationError } from "@/lib/replicate-server";
import { makePredictionRecorder, isCancelRequested } from "@/lib/generation-cancel";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed, findStoryboardImageAsset } from "@/lib/assets-db";
import { createAssetRelation } from "@/lib/asset-relations-db";
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
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import {
  resolveStoryboardStyle,
  storyboardVideoStyleDirective,
  resolveStoryboardAspectRatio,
  storyboardVideoAspectDirective,
  storyboardVideoDimensions,
  resolveStoryboardLanguage,
  storyboardLanguageDirective,
  fitSeedancePrompt,
  SEEDANCE_PROMPT_MAX_CHARS,
  DEFAULT_STORYBOARD_LANGUAGE,
  type StoryboardAspectRatio,
  type StoryboardLanguageId,
} from "@/lib/storyboard-style";
import {
  getVideoModel,
  isStoryboardVideoModelId,
  buildVideoProviderInput,
  DEFAULT_STORYBOARD_VIDEO_MODEL_ID,
  type StoryboardVideoModelId,
} from "@/lib/video-models";

// Vercel Hobby plan caps serverless functions at 300s (Pro allows up to 800s)
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Pricing Config v2.2: the storyboard-to-video clip is a fixed 15s Seedance run,
// priced via the selected model's per-second provider cost (Mini 480p → ~54 cr,
// Mini 720p → ~122 cr; Fast 480p → ~95 cr, Fast 720p → ~203 cr at v2 settings).
const STORYBOARD_VIDEO_DURATION_SEC = 15;
type StoryboardVideoResolution = "480p" | "720p";

export async function POST(req: Request) {
  // Platform-observability trackers — declared before the try so the catch block
  // and post-job-creation early-return error paths can finalize them.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let videoAssetId: string | null = null;
  // Credit-spend trackers — see app/api/generate-reels/route.ts for the pattern.
  let creditsSpent = false;
  let creditsAmount = 0;
  // Request-level idempotency row id (Double-Charge Protection v1).
  let generationRequestId: string | null = null;
  // Cleanup handles so the catch can reset a stuck storyboard out of
  // 'video_generating' on cancellation/failure (declared before the try).
  let storyboardIdForCleanup: string | null = null;
  let supabaseForCleanup: ReturnType<typeof getSupabase> | null = null;

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

    // ---- Tool-access guard (Admin Phase 2) ----
    // Storyboard is an engine inside the Reels tool, so it maps to tool_key 'reels'.
    // Returns 403 only when an admin disabled it; missing config / DB errors fail open.
    try {
      await assertToolEnabled("reels");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[storyboard-video] tool guard unexpected error (failing open):", e);
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

    // Resolution drives the Seedance per-second pricing tier. Validate strictly
    // (only 480p/720p); default 480p when omitted. Duration is fixed at 15s.
    const resolutionRaw = body.resolution;
    let resolution: StoryboardVideoResolution = "480p";
    if (resolutionRaw !== undefined && resolutionRaw !== null && resolutionRaw !== "") {
      if (resolutionRaw !== "480p" && resolutionRaw !== "720p") {
        return NextResponse.json(
          { error: "resolution must be '480p' or '720p'." },
          { status: 400 }
        );
      }
      resolution = resolutionRaw;
    }
    const durationSec = STORYBOARD_VIDEO_DURATION_SEC;

    const videoModelIdRaw = typeof body.videoModelId === "string" ? body.videoModelId.trim() : "";
    const videoModelId: StoryboardVideoModelId = isStoryboardVideoModelId(videoModelIdRaw)
      ? videoModelIdRaw
      : DEFAULT_STORYBOARD_VIDEO_MODEL_ID;
    const videoModel = getVideoModel(videoModelId);
    const promptMaxChars = videoModel.promptMaxChars ?? SEEDANCE_PROMPT_MAX_CHARS;

    if (!process.env.REPLICATE_API_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 }
      );
    }

    const supabase = getSupabase();

    const { data: row, error: fetchError } = await supabase
      .from(STORYBOARDS_TABLE)
      .select("id, user_id, theme, storyboard_url, seedance_prompt, storyboard_style, aspect_ratio, language")
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

    // Aspect ratio is OWNED by the storyboard so the video matches its orientation
    // (a vertical storyboard must never produce a horizontal video). The stored
    // value wins; a client-sent aspectRatio is only a fallback for legacy rows
    // saved before the column existed.
    const storedAspect: StoryboardAspectRatio | null = row.aspect_ratio
      ? resolveStoryboardAspectRatio(row.aspect_ratio)
      : null;
    const aspectRatio: StoryboardAspectRatio =
      storedAspect ?? resolveStoryboardAspectRatio(body.aspectRatio);

    // Spoken language. Unlike aspect ratio, language is a SOFT property: the model
    // can be re-instructed to speak another language, so a client-sent value wins
    // (lets the user change it at video time). Otherwise inherit the storyboard's
    // stored language, then fall back to the default (English).
    const clientLanguage: StoryboardLanguageId | null =
      typeof body.language === "string" && body.language.trim()
        ? resolveStoryboardLanguage(body.language)
        : null;
    const storedLanguage: StoryboardLanguageId | null = row.language
      ? resolveStoryboardLanguage(row.language)
      : null;
    const language: StoryboardLanguageId =
      clientLanguage ?? storedLanguage ?? DEFAULT_STORYBOARD_LANGUAGE;

    const storyboardUrl = String(row.storyboard_url || "").trim();
    const storedPrompt = String(row.seedance_prompt || "").trim();
    // Optional edited prompt from the Advanced "edit prompt" UI. Ownership is
    // already enforced above (row.user_id === userId), so the owner may override
    // the stored seedance_prompt; the edit is persisted below (after the spend)
    // so it sticks for future runs. The raw edited text is stored — the
    // style/aspect/language directives are re-applied transiently per run.
    const editedPrompt = typeof body.seedancePrompt === "string" ? body.seedancePrompt.trim() : "";
    const promptEdited = !!editedPrompt && editedPrompt !== storedPrompt;
    let seedancePrompt = promptEdited ? editedPrompt : storedPrompt;

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

    // ---- Assemble the final Seedance prompt within the 2000-char limit ----
    // The descriptive BODY (the stored/edited seedance_prompt, plus the [Image1]
    // composition reference) carries the scene beats and dialogue; the PREFIX
    // carries the framing directives that must survive.
    let promptBody = seedancePrompt;
    if (!/\[Image1\]/i.test(promptBody)) {
      promptBody = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${promptBody}`;
    }

    // Honor the storyboard's chosen visual style in the VIDEO, not just the sheet.
    // Prepending here (rather than only relying on the stored seedance_prompt) makes
    // existing storyboards — whose prompt predates style-aware generation — still
    // render in the picked aesthetic. The storyboard image stays the primary
    // composition reference; this directive sets the rendering style.
    const storyboardStyle = resolveStoryboardStyle(row.storyboard_style);
    const promptPrefix = `${storyboardVideoStyleDirective(storyboardStyle)}\n${storyboardVideoAspectDirective(aspectRatio)}\n${storyboardLanguageDirective(language)}`;

    // Seedance 2.0 hard-truncates prompts over 2000 chars FROM THE END, which
    // would silently drop the closing scene beats + dialogue. Build the prompt
    // ourselves so the framing directives are preserved and only the body is
    // trimmed at a clean sentence/word boundary when it would overflow.
    const fitted = fitSeedancePrompt(promptPrefix, promptBody, promptMaxChars);
    seedancePrompt = fitted.prompt;
    if (fitted.truncated) {
      console.warn(
        `[Storyboard Video] Seedance prompt trimmed from ${fitted.originalLength} to ${seedancePrompt.length} chars to fit the ${promptMaxChars}-char limit (storyboard ${storyboardId}, model ${videoModelId}). Consider shortening the prompt for full fidelity.`
      );
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    // ---- Resolve runtime model (Admin Phase 2) ----
    const resolvedVideoModel = await resolveModel({
      toolKey: "reels",
      configKey: videoModel.modelRole,
      fallback: {
        provider: "replicate",
        model: videoModel.providerModel,
        parameters: {},
      },
    });
    const videoModelRef = replicateRef(resolvedVideoModel);

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    // MUST run before createJob, spendCredits, the storyboards.status mutation,
    // or any provider call. Hash uses normalized client inputs only.
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      storyboardId,
      videoModelId,
      resolution,
      durationSec,
      aspectRatio,
      language,
      promptOverride: promptEdited ? editedPrompt : null,
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_storyboard_video",
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
    // Asset creation is deferred until after the credit spend succeeds.
    const job = await safe("createJob", () => createJob({
      profileId: profileId!,
      tool: "storyboard",
      jobType: "storyboard_video",
      provider: resolvedVideoModel.provider,
      model: resolvedVideoModel.model,
      input: {
        storyboardId,
        videoModelId,
        resolution,
        durationSec,
        aspectRatio,
        language,
        style: storyboardStyle,
      },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — not safe-wrapped) ----
    // Storyboard video is priced via the selected model's per-second provider cost
    // for the chosen resolution over the fixed 15s clip.
    const pricingKey = videoModel.pricingKey({ resolution, hasReferenceVideo: false });
    const requiredCredits = await getVideoCredits({ pricingKey, durationSec });
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
          videoModelId,
          resolution,
          durationSec,
          aspectRatio,
          language,
          style: storyboardStyle,
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
        if (generationRequestId) {
          await safe("idemFailInsufficient", () => finishGenerationRequestFailure({
            id: generationRequestId!,
            jobId: jobId ?? null,
            errorJson: {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            },
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
    // Persist an edited prompt here (not before the spend) so an insufficient-
    // credits abort never rewrites the stored prompt. Store the RAW edited text.
    const statusUpdate: Record<string, unknown> = { status: "video_generating" };
    if (promptEdited) statusUpdate.seedance_prompt = editedPrompt;
    // Arm cleanup: from here the storyboard is in 'video_generating', so a later
    // cancel/failure must reset it (see catch) to avoid a stuck spinner.
    storyboardIdForCleanup = storyboardId;
    supabaseForCleanup = supabase;
    const { error: statusErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update(statusUpdate)
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
      provider: resolvedVideoModel.provider,
      model: resolvedVideoModel.model,
      metadata: {
        storyboardId,
        videoModelId,
        resolution,
        durationSec,
        aspectRatio,
        language,
        style: storyboardStyle,
      },
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
    // If the user already hit Cancel between spend and provider call, abort now so
    // we never start (and pay for) a provider run we're about to throw away.
    if (generationRequestId && (await isCancelRequested(profileId!, generationRequestId))) {
      throw new ReplicateCancellationError();
    }
    console.log(
      `[Storyboard Video] Calling ${videoModel.modelLabel} (${durationSec}s, ${resolution}, ${aspectRatio}, audio, reference)...`
    );
    // Record each Replicate prediction id so POST /api/generations/cancel can stop
    // this run mid-flight (the SDK progress callback fires on create + each poll).
    const recordPredictionTick = makePredictionRecorder({
      generationRequestId,
      profileId,
      jobId,
      kind: "storyboard_video",
    });
    const providerInput = buildVideoProviderInput({
      model: videoModel,
      prompt: seedancePrompt,
      duration: durationSec,
      resolution,
      aspectRatio,
      generateAudio: true,
      references: { referenceImages: [storyboardUrl] },
    });
    const videoResult = await runReplicateWithRetry(
      replicate,
      videoModelRef,
      {
        input: providerInput,
      },
      10,
      { onPrediction: recordPredictionTick }
    );

    // Post-run cancel safety net: if the user cancelled while the prediction was
    // still in the provider's initial (pre-poll) window — before its id was
    // recorded, so it couldn't be stopped on Replicate — honor the cancel now by
    // refunding and NOT delivering the result, rather than charging for an unwanted clip.
    if (generationRequestId && profileId && (await isCancelRequested(profileId!, generationRequestId))) {
      throw new ReplicateCancellationError();
    }

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
        durationSec,
        width: storyboardVideoDimensions(resolution, aspectRatio).width,
        height: storyboardVideoDimensions(resolution, aspectRatio).height,
        costCredits: creditsAmount,
        metadata: {
          storyboardId,
          videoModelId,
          resolution,
          durationSec,
          aspectRatio,
          language,
          style: storyboardStyle,
        },
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
        output: {
          videoUrl,
          storagePath,
          assetId: videoAssetId,
          storyboardId,
          videoModelId,
          resolution,
          durationSec,
          aspectRatio,
          language,
          style: storyboardStyle,
        },
        costCredits: creditsAmount,
      }));
    }

    // Usage event — analytics only, NEVER affects billing/response.
    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: videoAssetId ?? null,
      tool: "storyboard",
      provider: resolvedVideoModel.provider,
      model: resolvedVideoModel.model,
      unitType: "video_seconds",
      units: durationSec,
      creditsCharged: creditsAmount,
      metadata: {
        jobType: "storyboard_video",
        storyboardId,
        videoModelId,
        resolution,
        durationSec,
        aspectRatio,
        language,
        style: storyboardStyle,
      },
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
        metadata: {
          storyboardId,
          aspectRatio,
          language,
          ...(row.theme ? { prompt: String(row.theme) } : {}),
        },
      });
    } catch (historyErr) {
      console.warn("[Storyboard Video] History log failed:", historyErr);
    }

    const successResponse = { videoUrl, aspectRatio, language, historyItem };
    if (generationRequestId) {
      await safe("idemSuccess", () => finishGenerationRequestSuccess({
        id: generationRequestId!,
        jobId: jobId ?? null,
        assetId: videoAssetId ?? null,
        responseJson: successResponse,
      }));
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    // User-initiated cancellation is a normal outcome, not a failure: the job is
    // marked 'cancelled' (not 'failed') and credits are refunded below.
    const cancelled = isCancellation(error);
    const message = cancelled
      ? "Generation cancelled."
      : error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");
    if (cancelled) console.log("[Storyboard Video] Cancelled by user.");
    else console.error("[Storyboard Video] Error:", error);
    // Pricing fail-closed (v2.2): an unknown pricing key throws BEFORE the spend
    // and any provider call, so no credits were charged and no provider ran.
    const pricingMissing = error instanceof PricingConfigError;
    // Best-effort failure marking — must not throw or mask the original error.
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
    // Reset the storyboard out of 'video_generating' back to 'ready' so a
    // cancelled/failed run does not leave it stuck spinning, and the user can
    // immediately retry video generation.
    if (storyboardIdForCleanup && supabaseForCleanup) {
      await safe("resetStoryboardStatus", async () => {
        await supabaseForCleanup!
          .from(STORYBOARDS_TABLE)
          .update({ status: "ready" })
          .eq("id", storyboardIdForCleanup!);
      });
    }
    if (jobId && profileId) {
      if (cancelled) {
        await safe("cancelJob", () => cancelJob(profileId!, jobId!, errJson));
      } else {
        await safe("failJob", () => failJob(profileId!, jobId!, errJson));
      }
    }

    // Best-effort refund. Fires whenever spendCredits succeeded — covers both
    // failures and user cancellations (the user must not pay for a cancelled run).
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:storyboard_video:${jobId}`
          : `refund:storyboard_video:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: cancelled
          ? "Refund after user cancellation"
          : "Best-effort refund after generation failure",
        metadata: { reason: cancelled ? "generation_cancelled" : "generation_failed", originalError: errJson },
      }));
    }

    if (generationRequestId) {
      await safe("idemFailure", () => finishGenerationRequestFailure({
        id: generationRequestId!,
        jobId: jobId ?? null,
        errorJson: errJson,
      }));
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
  }
}
