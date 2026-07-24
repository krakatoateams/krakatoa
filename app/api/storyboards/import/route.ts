import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
import { getSupabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  isVideosTempRefPath,
} from "@/lib/storage-buckets";
import { storyboardSheetPath } from "@/lib/product-photo";
import {
  flattenReplicateTextChunks,
  runReplicateWithRetry,
  stripMarkdownFences,
} from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getStoryboardImportCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getStoryboardModels, replicateRef } from "@/lib/model-resolver";
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
  resolveStoryboardLanguage,
  storyboardLanguageLabel,
  SEEDANCE_PROMPT_BODY_BUDGET_CHARS,
  type StoryboardAspectRatio,
} from "@/lib/storyboard-style";

// Vercel Hobby plan caps serverless functions at 300s (Pro allows up to 800s)
export const maxDuration = 300;

/**
 * POST /api/storyboards/import — register a USER-UPLOADED storyboard sheet as a
 * Kelolako storyboard so it can be turned into a video.
 *
 * The user's image is uploaded by the browser to videos/temp/refs/ via the
 * existing signed-upload flow; this route receives its transient path, runs a
 * GPT-5 VISION pass to synthesize the seedance_prompt (no image is generated),
 * moves the image to the permanent videos/storyboard/ path, and inserts a
 * `storyboards` row (source='uploaded', status='ready'). The downstream video
 * step (/api/generate-storyboard-video) is unchanged — it only needs the row.
 *
 * Credit contract (mirrors the other charged routes):
 *   validate -> createJob -> spendCredits (vision) BEFORE the provider call ->
 *   provider -> move + insert -> finishJob -> usage. Insufficient => 402 (no
 *   provider call). Post-spend failure => best-effort refund + storage cleanup.
 */
export async function POST(req: Request) {
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let imageAssetId: string | null = null;
  let creditsSpent = false;
  let creditsAmount = 0;
  let generationRequestId: string | null = null;
  // Storage lifecycle trackers — so failures never orphan files.
  let tempPath: string | null = null;
  let permanentPath: string | null = null;
  let movedToPermanent = false;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[storyboard-import obs] ${label} failed:`, e);
      return null;
    }
  };

  const supabase = getSupabase();

  // Best-effort: drop whichever copy of the upload currently exists. After a
  // successful move the temp source is already gone, so we target the permanent
  // copy; before the move we target the temp upload.
  const cleanupStorage = async (): Promise<void> => {
    const path = movedToPermanent ? permanentPath : tempPath;
    if (!path) return;
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    } catch (e) {
      console.warn("[storyboard-import] storage cleanup failed:", e);
    }
  };

  try {
    // STRICT profile resolution (this route charges credits).
    //   profile.id      -> platform tables (jobs / assets) + credits
    //   profile.user_id -> legacy storyboards.user_id + user_creations (= users.id)
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[storyboard-import] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // Storyboard is an engine inside the Reels tool → tool_key 'reels'.
    try {
      await assertToolEnabled("reels");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[storyboard-import] tool guard unexpected error (failing open):", e);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // The transient upload path (videos/temp/refs/...). Validated to that prefix
    // so a caller can't point us at an arbitrary object to move/delete.
    const rawPath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
    if (!rawPath || !isVideosTempRefPath(rawPath)) {
      return NextResponse.json(
        { error: "A freshly uploaded image is required (imagePath under videos/temp/refs/)." },
        { status: 400 }
      );
    }
    tempPath = rawPath;

    const description =
      typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
    const storyboardStyle = resolveStoryboardStyle(body.storyboardStyle);
    const aspectRatio = resolveStoryboardAspectRatio(body.aspectRatio);
    const language = resolveStoryboardLanguage(body.language);
    const languageLabel = storyboardLanguageLabel(language);

    if (!process.env.REPLICATE_API_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 }
      );
    }

    // Public URL of the transient upload — GPT-5 vision fetches it directly.
    // (rawPath is the non-null source path; tempPath/permanentPath stay nullable
    // for the cleanup closure, so TS can't narrow them at the storage calls.)
    const { data: tempUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(rawPath);
    const tempPublicUrl = tempUrlData.publicUrl;
    if (!tempPublicUrl.startsWith("https://")) {
      return NextResponse.json(
        { error: "Uploaded image is not reachable over https." },
        { status: 400 }
      );
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const { sceneLlm: sceneLlmModel } = await getStoryboardModels();
    const sceneLlmRef = replicateRef(sceneLlmModel);

    // ---- Idempotency gate (Double-Charge Protection v1) ----
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      source: "uploaded",
      imagePath: tempPath,
      storyboardStyle,
      aspectRatio,
      language,
      description,
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "storyboard_import",
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
        { error: "Import already in progress, please wait.", code: "GENERATION_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (begin.action === "replay") {
      return NextResponse.json(begin.response);
    }
    generationRequestId = begin.id;

    // ---- Platform job ----
    const job = await safe("createJob", () => createJob({
      profileId: profileId!,
      tool: "storyboard",
      jobType: "storyboard_import",
      provider: sceneLlmModel.provider,
      model: sceneLlmModel.model,
      input: { source: "uploaded", storyboardStyle, aspectRatio, language, hasDescription: !!description },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BEFORE the vision provider call) ----
    const requiredCredits = await getStoryboardImportCredits();
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:storyboard_import:${jobId}`
          : `spend:storyboard_import:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Storyboard import (vision analysis)",
        metadata: { tool: "storyboard", jobType: "storyboard_import", storyboardStyle, aspectRatio, language },
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
            errorJson: { code: "INSUFFICIENT_CREDITS", message: "Insufficient credits.", requiredCredits, currentBalance },
          }));
        }
        // No provider call happened — drop the transient upload.
        await cleanupStorage();
        return NextResponse.json(
          { error: "Insufficient credits.", requiredCredits, currentBalance },
          { status: 402 }
        );
      }
      throw e;
    }

    // ---- Processing asset (created AFTER spend) ----
    const asset = await safe("createAsset", () => createProcessingAsset({
      profileId: profileId!,
      jobId: jobId ?? undefined,
      tool: "storyboard",
      assetType: "image",
      role: "storyboard_image",
      provider: sceneLlmModel.provider,
      model: sceneLlmModel.model,
      metadata: { source: "uploaded", storyboardStyle, aspectRatio, language },
    }));
    if (asset) imageAssetId = asset.id;

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

    // ---- GPT-5 vision: synthesize the seedance_prompt from the uploaded sheet ----
    await beginStep("vision_analysis", "GPT-5 vision storyboard analysis");
    const videoStyleDirective = storyboardVideoStyleDirective(storyboardStyle);
    const MAX_JSON_ATTEMPTS = 3;
    let analysis: { scenes: unknown[]; seedancePrompt: string } | null = null;
    for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
      console.log(`[storyboard-import] Vision via ${sceneLlmRef} (attempt ${attempt}/${MAX_JSON_ATTEMPTS})...`);
      const out = await runReplicateWithRetry(replicate, sceneLlmRef, {
        input: {
          system_prompt: buildImportVisionSystemPrompt(aspectRatio, languageLabel),
          prompt: buildImportUserPrompt(description, videoStyleDirective),
          image_input: [tempPublicUrl],
          reasoning_effort: "low",
          max_completion_tokens: 8192,
        },
      });
      const rawText = stripMarkdownFences(flattenReplicateTextChunks(out).trim());
      try {
        analysis = parseImportPayload(rawText);
        break;
      } catch (err) {
        if (attempt === MAX_JSON_ATTEMPTS) throw err;
        console.warn("[storyboard-import] vision JSON parse failed, retrying:", err);
      }
    }
    if (!analysis) throw new Error("Vision model did not return a usable storyboard analysis.");
    await endStep({ scenes: analysis.scenes.length });

    let seedancePrompt = analysis.seedancePrompt;
    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the composition and beats in [Image1].\n\n${seedancePrompt}`;
    }
    // Persist the orientation into the stored prompt (mirrors the generate flow).
    seedancePrompt = `${storyboardVideoAspectDirective(aspectRatio)}\n\n${seedancePrompt}`;

    // ---- Move the upload to the permanent storyboard path ----
    await beginStep("storage_move", "Move uploaded storyboard to permanent path");
    const ext = (rawPath.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const filename = `image_uploaded_${Date.now()}.${ext}`;
    const destPath = storyboardSheetPath(userId!, filename);
    permanentPath = destPath;
    const { error: moveErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .move(rawPath, destPath);
    if (moveErr) {
      throw new Error(`Failed to move uploaded storyboard: ${moveErr.message}`);
    }
    movedToPermanent = true;
    const {
      data: { publicUrl: storyboardUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(destPath);
    await endStep({ storagePath: destPath, publicUrl: storyboardUrl });

    // ---- Insert the storyboards row ----
    const theme = (description || "Imported storyboard").slice(0, 200);
    const { data: inserted, error: insertError } = await supabase
      .from(STORYBOARDS_TABLE)
      .insert({
        theme,
        storyboard_url: storyboardUrl,
        seedance_prompt: seedancePrompt,
        scene_breakdown: { scenes: analysis.scenes },
        storyboard_style: storyboardStyle,
        aspect_ratio: aspectRatio,
        language,
        source: "uploaded",
        status: "ready",
        user_id: userId,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      console.error("[storyboard-import] DB insert error:", insertError);
      throw new Error(insertError?.message || "Failed to save imported storyboard.");
    }

    if (imageAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, imageAssetId!, {
        storagePath: permanentPath!,
        publicUrl: storyboardUrl,
        mimeType: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png",
        costCredits: creditsAmount,
        metadata: { storyboardId: inserted.id, source: "uploaded", storyboardStyle, aspectRatio, language },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { storyboardId: inserted.id, storyboardUrl, storagePath: permanentPath, assetId: imageAssetId, source: "uploaded" },
        costCredits: creditsAmount,
      }));
    }

    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: imageAssetId ?? null,
      tool: "storyboard",
      provider: sceneLlmModel.provider,
      model: sceneLlmModel.model,
      unitType: "images",
      units: 1,
      creditsCharged: creditsAmount,
      metadata: { jobType: "storyboard_import", source: "uploaded", storyboardStyle, aspectRatio, language, storyboardId: inserted.id },
    }));

    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: "storyboard",
        mediaType: "image",
        mediaUrl: storyboardUrl,
        storagePath: permanentPath,
        title: theme,
        metadata: { storyboardId: inserted.id, source: "uploaded", storyboardStyle, aspectRatio, language },
      });
    } catch (historyErr) {
      console.warn("[storyboard-import] History log failed:", historyErr);
    }

    console.log("[storyboard-import] Done:", storyboardUrl, "id:", inserted.id);
    const successResponse = {
      storyboardId: inserted.id,
      storyboardUrl,
      seedancePrompt,
      aspectRatio,
      language,
      source: "uploaded",
      historyItem,
    };
    if (generationRequestId) {
      await safe("idemSuccess", () => finishGenerationRequestSuccess({
        id: generationRequestId!,
        jobId: jobId ?? null,
        assetId: imageAssetId ?? null,
        responseJson: successResponse,
      }));
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[storyboard-import] Error:", error);
    const pricingMissing = error instanceof PricingConfigError;
    const errJson = pricingMissing
      ? { message, code: "PRICING_CONFIG_MISSING" }
      : { message };
    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (imageAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, imageAssetId!, errJson));
    }
    if (jobId && profileId) {
      await safe("failJob", () => failJob(profileId!, jobId!, errJson));
    }

    // Best-effort refund (only when the spend actually succeeded).
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:storyboard_import:${jobId}`
          : `refund:storyboard_import:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Best-effort refund after import failure",
        metadata: { reason: "import_failed", originalError: errJson },
      }));
    }

    // Drop whichever copy of the upload exists so failures never orphan storage.
    await cleanupStorage();

    if (generationRequestId) {
      await safe("idemFailure", () => finishGenerationRequestFailure({
        id: generationRequestId!,
        jobId: jobId ?? null,
        errorJson: errJson,
      }));
    }

    return NextResponse.json(
      pricingMissing ? { error: message, code: "PRICING_CONFIG_MISSING" } : { error: message },
      { status: 500 }
    );
  }
}

function buildImportVisionSystemPrompt(
  aspectRatio: StoryboardAspectRatio,
  languageLabel: string
): string {
  const orientation =
    aspectRatio === "9:16" ? "vertical/portrait" : "widescreen/landscape";
  return `You are a film pre-visualization analyst. You are given ONE storyboard reference image, addressed as [Image1], that the user uploaded. Study its panels, characters, and composition, then plan how to turn it into a 15-second ${orientation} ${aspectRatio} video with native audio.

Reply with ONLY valid JSON (no markdown code fences, no text before or after the JSON). Shape:
{
  "scenes": [
    {
      "scene_id": <number, starting at 1>,
      "timestamp_range": "<string, e.g. 0:00-0:03>",
      "visual_description": "<string grounded in what [Image1] depicts>",
      "character_dialogue": "<spoken lines in ${languageLabel}, or empty string>",
      "mood": "<string>"
    }
  ],
  "seedance_prompt": "<single plain-text string>"
}

Rules:
- Derive the scenes from what is ACTUALLY shown in [Image1]; use between 3 and 6 scenes whose timestamp ranges partition the 15 seconds (0:00 through 0:15) with no gaps or overlap.
- Frame every visual_description for a ${orientation} ${aspectRatio} video.
- "seedance_prompt": one plain-text prompt for Seedance 2.0 Fast (15s, ${aspectRatio} ${orientation}, native audio). It MUST refer to the storyboard as [Image1] and follow its composition and beats. Include overall cinematic style, lighting, atmosphere, camera language, and pacing. Write ALL spoken lines in ${languageLabel}, placed in double quotes as Seedance expects (e.g. the character says: "..."). Describe ambient sound and music mood.
- CRITICAL: keep "seedance_prompt" at or under ${SEEDANCE_PROMPT_BODY_BUDGET_CHARS} characters. Seedance hard-truncates the final prompt at 2000 characters AFTER runtime style/orientation/language directives are prepended, so an over-long prompt loses its closing beats and dialogue. Be concise and information-dense: prioritize the spoken lines and the key visual beat of each scene over decorative description.`;
}

function buildImportUserPrompt(description: string, videoStyleDirective: string): string {
  const intent = description
    ? `The user describes their intent for the video as: "${description}". Incorporate this where it does not contradict the image.`
    : `No extra description was provided — rely on [Image1] alone.`;
  return `Analyze the uploaded storyboard [Image1] and produce the JSON described in the system prompt.

${intent}

The finished video must be rendered in this visual style — bake it explicitly into the "seedance_prompt" so the video model honors it: ${videoStyleDirective}`;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to balanced-bracket scan */
  }
  const start = cleaned.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("No valid JSON found in vision response");
}

/**
 * Lenient parse for the import vision payload. Unlike the generate flow we do
 * NOT require exactly six scenes (an uploaded sheet may have any number of
 * panels); we only require a non-empty seedance_prompt and tolerate any scenes
 * array (stored as scene_breakdown for reference).
 */
function parseImportPayload(raw: string): { scenes: unknown[]; seedancePrompt: string } {
  const parsed = extractJson(raw) as Record<string, unknown>;
  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const seedRaw = parsed.seedance_prompt ?? parsed.seedancePrompt;
  if (typeof seedRaw !== "string" || !seedRaw.trim()) {
    throw new Error("Vision JSON must include a non-empty seedance_prompt string.");
  }
  return { scenes, seedancePrompt: seedRaw.trim() };
}
