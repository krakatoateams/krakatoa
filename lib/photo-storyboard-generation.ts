import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
import { resolveMentionCreations } from "@/lib/mention-assets-server";
import { getSupabase } from "@/lib/supabase";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
} from "@/lib/storage-buckets";
import { signStoragePathForUser } from "@/lib/storage-signed-url";
import { storyboardSheetPath } from "@/lib/product-photo";
import {
  extractMediaUrl,
  flattenReplicateTextChunks,
  runReplicateWithRetry,
  stripMarkdownFences,
  isCancellation,
} from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { finishJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep } from "@/lib/job-steps-db";
import { assembledModelStepInput } from "@/lib/admin-prompt-capture-pure";
import {
  beginMeteredAttempt,
  finishMeteredAttempt,
  type MeteredAttemptHandle,
} from "@/lib/metered-generation/lifecycle";
import { markAssetReady } from "@/lib/assets-db";
import { getStoryboardImageCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getStoryboardModels, replicateRef } from "@/lib/model-resolver";
import { labelForProviderModel } from "@/lib/creation-model-label";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
} from "@/lib/generation-idempotency";
import {
  assertNotCancelled,
  makeReplicateCancelHooks,
} from "@/lib/generation-cancel";
import { markProviderCommitted, isRefundableUserCancellation } from "@/lib/generation-commit";
import {
  DevBlankForbiddenError,
  DEV_BLANK_REQUEST_KEY,
  devBlankJobTag,
  isDevBlankFormValue,
  isDevBlankRequested,
  readBlankImageBytes,
  requireDevBlankAccess,
} from "@/lib/dev-blank-generation";
import {
  resolveStoryboardStyle,
  STORYBOARD_STYLE_INSTRUCTIONS,
  storyboardVideoStyleDirective,
  resolveStoryboardAspectRatio,
  storyboardImageAspectDirective,
  storyboardVideoAspectDirective,
  resolveStoryboardLanguage,
  storyboardLanguageLabel,
  SEEDANCE_PROMPT_BODY_BUDGET_CHARS,
  type StoryboardAspectRatio,
} from "@/lib/storyboard-style";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";

export type PhotoStoryboardGenerationOptions = {
  /** Pre-parsed body when the caller already read `req` (e.g. generate-photo). */
  formData?: FormData;
};

// Max @-mentioned assets (saved characters / storyboards) used as references.
const MAX_MENTIONS = 8;
// gpt-image-2 input_images cap — uploaded theme reference uses one slot.
const MAX_INPUT_IMAGES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function validateImageUpload(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Only JPEG, PNG, or WebP images are supported";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Image must be 10MB or smaller";
  }
  return null;
}

type StoryboardRequestInput = {
  theme: string;
  storyboardStyle: unknown;
  aspectRatio: unknown;
  language: unknown;
  referenceCreationIds: string[];
  referenceFile: File | null;
  devBlank: boolean;
};

function placeholderSceneBreakdown(): SceneBreakdown[] {
  return Array.from({ length: 6 }, (_, i) => ({
    scene_id: i + 1,
    timestamp_range: `${i * 2.5}-${(i + 1) * 2.5}s`,
    visual_description: "Dev blank placeholder panel.",
    character_dialogue: "",
    mood: "neutral",
  }));
}

async function parseStoryboardRequest(
  req: Request,
  existingFormData?: FormData
): Promise<StoryboardRequestInput> {
  if (existingFormData) {
    const referenceRaw = existingFormData.get("reference");
    return {
      theme: String(existingFormData.get("theme") || "").trim(),
      storyboardStyle: existingFormData.get("storyboardStyle"),
      aspectRatio: existingFormData.get("aspectRatio"),
      language: existingFormData.get("language"),
      referenceCreationIds: String(existingFormData.get("referenceCreationIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      referenceFile: referenceRaw instanceof File && referenceRaw.size > 0 ? referenceRaw : null,
      devBlank: isDevBlankFormValue(existingFormData.get(DEV_BLANK_REQUEST_KEY)),
    };
  }
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const referenceRaw = formData.get("reference");
    return {
      theme: String(formData.get("theme") || "").trim(),
      storyboardStyle: formData.get("storyboardStyle"),
      aspectRatio: formData.get("aspectRatio"),
      language: formData.get("language"),
      referenceCreationIds: String(formData.get("referenceCreationIds") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      referenceFile: referenceRaw instanceof File && referenceRaw.size > 0 ? referenceRaw : null,
      devBlank: isDevBlankFormValue(formData.get(DEV_BLANK_REQUEST_KEY)),
    };
  }
  const body = await req.json();
  return {
    theme: typeof body.theme === "string" ? body.theme.trim() : "",
    storyboardStyle: body.storyboardStyle,
    aspectRatio: body.aspectRatio,
    language: body.language,
    referenceCreationIds: Array.isArray(body.referenceCreationIds)
      ? body.referenceCreationIds
          .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
      : [],
    referenceFile: null,
    devBlank: isDevBlankRequested(body),
  };
}

/*
  Supabase — add storyboard style column (run once in SQL editor):

  alter table storyboards add column if not exists storyboard_style text default 'cinematic_sketch';
*/

type SceneBreakdown = {
  scene_id: number;
  timestamp_range: string;
  visual_description: string;
  character_dialogue: string;
  mood: string;
};

function buildSceneSystemPrompt(
  aspectRatio: StoryboardAspectRatio,
  languageLabel: string
): string {
  const orientation =
    aspectRatio === "9:16" ? "vertical/portrait" : "widescreen/landscape";
  return `You are a film pre-visualization writer. Reply with ONLY valid JSON (no markdown code fences, no text before or after the JSON).

The JSON object MUST have exactly this shape:
{
  "scenes": [
    {
      "scene_id": <number 1-6>,
      "timestamp_range": "<string, e.g. 0:00-0:02.5>",
      "visual_description": "<string>",
      "character_dialogue": "<string>",
      "mood": "<string>"
    }
  ],
  "seedance_prompt": "<single string>"
}

Rules:
- "scenes" MUST be an array of exactly 6 objects, scene_id 1 through 6 in order. Timestamp ranges must partition a 15-second video (0:00 through 0:15) with no gaps or overlap.
- Each scene: concrete visual_description, character_dialogue written in ${languageLabel}, mood. Frame every visual_description for a ${orientation} ${aspectRatio} video.
- "seedance_prompt": one plain-text prompt for Seedance 2.0 Fast (15s, ${aspectRatio} ${orientation}, native audio). It MUST refer to the storyboard as [Image1] and align beats to the six scenes. Include overall cinematic style, lighting, atmosphere, camera language, pacing. Write ALL spoken lines in ${languageLabel}, placed in double quotes as Seedance expects (e.g. the character says: "..."). Describe ambient sound and music mood.
- CRITICAL: keep "seedance_prompt" at or under ${SEEDANCE_PROMPT_BODY_BUDGET_CHARS} characters. Seedance hard-truncates the final prompt at 2000 characters AFTER runtime style/orientation/language directives are prepended, so an over-long prompt loses its closing beats and dialogue. Be concise and information-dense: prioritize the spoken lines and the key visual beat of each scene over decorative description.`;
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }

  const findBalanced = (
    text: string,
    open: string,
    close: string
  ): string | null => {
    const start = text.indexOf(open);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  };

  const obj = findBalanced(cleaned, "{", "}");
  if (obj) {
    try {
      return JSON.parse(obj);
    } catch {
      /* fall through */
    }
  }
  throw new Error("No valid JSON found in GPT-5 response");
}

function isScene(o: unknown): o is SceneBreakdown {
  if (!o || typeof o !== "object") return false;
  const s = o as Record<string, unknown>;
  return (
    typeof s.scene_id === "number" &&
    typeof s.timestamp_range === "string" &&
    typeof s.visual_description === "string" &&
    typeof s.character_dialogue === "string" &&
    typeof s.mood === "string"
  );
}

function parseScenePayload(raw: string): {
  scenes: SceneBreakdown[];
  seedancePrompt: string;
} {
  const parsed = extractJson(raw) as Record<string, unknown>;
  const scenesRaw = parsed.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length !== 6) {
    throw new Error("GPT-5 JSON must contain exactly 6 scenes.");
  }
  const scenes: SceneBreakdown[] = [];
  for (let i = 0; i < 6; i++) {
    if (!isScene(scenesRaw[i])) {
      throw new Error(`Scene ${i + 1} is missing required fields or wrong types.`);
    }
    scenes.push(scenesRaw[i]);
  }
  for (let i = 0; i < 6; i++) {
    if (scenes[i].scene_id !== i + 1) {
      throw new Error(`Expected scene_id ${i + 1}, got ${scenes[i].scene_id}.`);
    }
  }
  const seedRaw = parsed.seedance_prompt ?? parsed.seedancePrompt;
  if (typeof seedRaw !== "string" || !seedRaw.trim()) {
    throw new Error("GPT-5 JSON must include a non-empty seedance_prompt string.");
  }
  return { scenes, seedancePrompt: seedRaw.trim() };
}

function buildStoryboardImagePrompt(
  theme: string,
  scenes: SceneBreakdown[],
  styleInstruction: string,
  aspectDirective: string
): string {
  const blocks = scenes.map(
    (s) =>
      `Scene ${s.scene_id} (${s.timestamp_range}): Visual: ${s.visual_description}. Dialogue / lines: ${s.character_dialogue}. Mood: ${s.mood}.`
  );
  return `Create ONE single image: a professional cinematic storyboard sheet for a 15-second video.

Overall theme: "${theme}"

Panels must follow these six scenes exactly (one panel per scene, in order 1→6):

${blocks.join("\n\n")}

Layout requirements:
- Exactly SIX panels in a clear grid (e.g. 2×3 or 3×2) on one canvas.
- ${aspectDirective}
- Each panel labeled with scene number, its timestamp range, visual description, and dialogue as on-set storyboard annotations.
${styleInstruction ? `- ${styleInstruction}\n` : ""}- Keep characters and setting consistent across panels where the story continues.
- One image only; do not output multiple files.`;
}

export async function handlePhotoStoryboardGeneration(
  req: Request,
  options: PhotoStoryboardGenerationOptions = {}
): Promise<NextResponse> {
  // Platform-observability trackers — declared before the try so the catch block
  // and early-return error paths can finalize whatever was created. They stay
  // null when observability is skipped, making every platform write a no-op.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let imageAssetId: string | null = null;
  // Credit-spend trackers — see app/api/generate-reels/route.ts for the pattern.
  let creditsSpent = false;
  let creditsAmount = 0;
  // Request-level idempotency row id (Double-Charge Protection v1).
  let generationRequestId: string | null = null;
  let metered: MeteredAttemptHandle | null = null;

  // Best-effort wrapper: platform writes must NEVER crash generation or mask the
  // original error.
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[photo storyboard obs] ${label} failed:`, e);
      return null;
    }
  };

  try {
    // STRICT profile resolution — this route now charges credits. See
    // app/api/generate-reels/route.ts for the rationale; non-auth failures now
    // surface as 500 rather than silently allowing free generation.
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
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
      console.error("[photo storyboard] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // Storyboard is a Photo studio mode (POST /api/generate-photo?mode=storyboard).
    try {
      await assertToolEnabled("photo");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[photo storyboard] tool guard unexpected error (failing open):", e);
    }

    const parsed = await parseStoryboardRequest(req, options.formData);
    const devBlank = parsed.devBlank;
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
    const theme = parsed.theme;
    const storyboardStyle = resolveStoryboardStyle(parsed.storyboardStyle);
    const styleInstruction = STORYBOARD_STYLE_INSTRUCTIONS[storyboardStyle];
    // Chosen orientation (default 16:9). Threaded into the scene LLM, the panel
    // framing, AND stored on the row so the video step renders the same ratio.
    const aspectRatio = resolveStoryboardAspectRatio(parsed.aspectRatio);
    const aspectDirective = storyboardImageAspectDirective(aspectRatio);
    // Spoken language for the dialogue/narration (default English). Drives the
    // scene LLM and is stored so the video step can reuse (or override) it.
    const language = resolveStoryboardLanguage(parsed.language);
    const languageLabel = storyboardLanguageLabel(language);
    // Same chosen style, phrased for the eventual Seedance VIDEO so the
    // seedance_prompt GPT-5 writes is rendered in that aesthetic (not just the sheet).
    const videoStyleDirective = storyboardVideoStyleDirective(storyboardStyle);
    const referenceFile = parsed.referenceFile;
    const hasThemeReference = referenceFile instanceof File;
    if (!theme) {
      return NextResponse.json(
        { error: "Theme is required and cannot be empty." },
        { status: 400 }
      );
    }
    if (hasThemeReference) {
      const fileErr = validateImageUpload(referenceFile);
      if (fileErr) {
        return NextResponse.json({ error: fileErr }, { status: 400 });
      }
    }

    // @-mentions: tagged saved characters / storyboards. Resolve each owner-scoped
    // to its image URL (passed to the image model as a reference) and remember its
    // name + kind so the prompt can name what each reference depicts. Validated
    // BEFORE any spend so a bad mention never charges credits.
    const mentionCap = hasThemeReference ? MAX_MENTIONS - 1 : MAX_MENTIONS;
    const referenceCreationIds = parsed.referenceCreationIds.slice(0, mentionCap);
    const mentionReferenceUrls: string[] = [];
    const mentionRefs: { name: string; kind: "character" | "storyboard" | "image" }[] = [];
    if (hasThemeReference) {
      mentionRefs.push({ name: "Theme", kind: "image" });
    }
    if (referenceCreationIds.length && userId) {
      const resolved = await resolveMentionCreations(userId, referenceCreationIds);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      for (const item of resolved.items) {
        mentionReferenceUrls.push(item.url);
        mentionRefs.push(item.ref);
      }
    }

    if (!devBlank && !process.env.REPLICATE_API_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 }
      );
    }

    const replicate = devBlank
      ? null
      : new Replicate({
          auth: process.env.REPLICATE_API_TOKEN,
        });

    // ---- Resolve runtime models (Admin Phase 2) ----
    // DB-backed config with fallback. The image model is the billed/recorded
    // model and is reused across createJob, createProcessingAsset, the image
    // provider call, and recordUsageEvent. The scene LLM is resolved separately
    // for the breakdown call.
    const { sceneLlm: sceneLlmModel, image: imageModel } = await getStoryboardModels();
    const sceneLlmRef = replicateRef(sceneLlmModel);
    const imageModelRef = replicateRef(imageModel);

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    // MUST run before createJob, spendCredits, or any provider call. Hash uses
    // normalized client inputs only (never the key, pricing, or model config).
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      mode: "storyboard",
      theme,
      storyboardStyle,
      aspectRatio,
      language,
      mentionRefs: referenceCreationIds.join(","),
      hasThemeReference,
      devBlank,
    });
    const requiredCredits = devBlank ? 0 : await getStoryboardImageCredits();
    const beginResult = await beginMeteredAttempt({
      profileId: profileId!,
      userId,
      idempotency: {
        key: idemKey,
        routeKey: "generate_photo",
        toolKey: "photo",
        requestHash,
      },
      job: {
        tool: "photo",
        jobType: "storyboard_image",
        provider: devBlank ? "dev_blank" : imageModel.provider,
        model: devBlank ? "dev_blank" : imageModel.model,
        input: {
          mode: "storyboard",
          theme: theme.slice(0, 500),
          storyboardStyle,
          aspectRatio,
          language,
          ...(devBlank ? devBlankJobTag() : {}),
        },
      },
      spend: {
        amount: requiredCredits,
        jobType: "storyboard_image",
        description: "Storyboard image generation",
        metadata: {
          tool: "photo",
          mode: "storyboard",
          jobType: "storyboard_image",
          storyboardStyle,
          aspectRatio,
          language,
        },
        skip: devBlank,
      },
      processingAssets: [
        {
          tool: "photo",
          assetType: "image",
          role: "storyboard_image",
          provider: devBlank ? "dev_blank" : imageModel.provider,
          model: devBlank ? "dev_blank" : imageModel.model,
          metadata: {
            storyboardStyle,
            aspectRatio,
            language,
            theme: theme.slice(0, 200),
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
    imageAssetId = metered.assetIds[0] ?? null;

    const replicateHooks = makeReplicateCancelHooks({
      generationRequestId,
      profileId,
      jobId,
      kind: "storyboard_image",
    });

    // Step-recording helpers (best-effort; manage currentStepId).
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

    const themeRefSceneNote = hasThemeReference
      ? "\n\nA visual theme reference image will be supplied to the storyboard artist. Write visual_descriptions that align with that reference's color palette, mood, lighting, and overall aesthetic."
      : "";

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    let scenes: SceneBreakdown[];
    let seedancePrompt: string;
    let imageBuffer: ArrayBuffer;

    if (devBlank) {
      await beginStep("dev_blank", "Deliver blank placeholder storyboard (admin test)");
      const blank = await readBlankImageBytes();
      imageBuffer = blank.buffer.slice(
        blank.byteOffset,
        blank.byteOffset + blank.byteLength
      ) as ArrayBuffer;
      scenes = placeholderSceneBreakdown();
      seedancePrompt = `${storyboardVideoAspectDirective(aspectRatio)}\n\n[Dev blank] Follow the six-panel plan in [Image1]. Theme: ${theme}`;
      await endStep({ devBlank: true });
    } else {
    await beginStep("scene_breakdown", "GPT-5 scene breakdown + seedance prompt");
    const MAX_JSON_ATTEMPTS = 3;
    let breakdown: { scenes: SceneBreakdown[]; seedancePrompt: string } | null =
      null;

    for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
      if (generationRequestId && profileId) {
        await assertNotCancelled(profileId, generationRequestId);
      }
      console.log(`[Storyboard] Scene breakdown via ${sceneLlmRef} (attempt ${attempt}/${MAX_JSON_ATTEMPTS})...`);
      const gptOut = await runReplicateWithRetry(
        replicate!,
        sceneLlmRef,
        {
          input: {
            system_prompt: buildSceneSystemPrompt(aspectRatio, languageLabel),
            prompt: `Video theme: ${theme}${themeRefSceneNote}\n\n${
              videoStyleDirective
                ? `The finished video must be rendered in this visual style — bake it into the "seedance_prompt" (state the style explicitly so the video model honors it): ${videoStyleDirective}\nKeep each scene's "visual_description" focused on action and content; the storyboard style is applied separately.\n\n`
                : ""
            }Produce the JSON with scenes and seedance_prompt as specified.`,
            reasoning_effort: "low",
            verbosity: "high",
            max_completion_tokens: 8192,
          },
        },
        10,
        replicateHooks,
      );

      const rawText = stripMarkdownFences(
        flattenReplicateTextChunks(gptOut).trim()
      );
      try {
        breakdown = parseScenePayload(rawText);
        break;
      } catch (e) {
        if (attempt === MAX_JSON_ATTEMPTS) throw e;
        console.warn("[Storyboard] JSON parse failed, retrying:", e);
      }
    }

    if (!breakdown) {
      throw new Error("GPT-5 did not return a valid scene breakdown.");
    }
    await endStep({ scenes: breakdown.scenes.length });

    const { scenes: parsedScenes, seedancePrompt: rawSeedancePrompt } = breakdown;
    scenes = parsedScenes;
    let seedancePromptDraft = rawSeedancePrompt;
    if (!/\[Image1\]/i.test(seedancePromptDraft)) {
      seedancePromptDraft = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePromptDraft}`;
    }
    // Persist the orientation into the stored prompt so the video step renders the
    // chosen ratio even if it relied solely on seedance_prompt.
    seedancePrompt = `${storyboardVideoAspectDirective(aspectRatio)}\n\n${seedancePromptDraft}`;

    let imagePrompt = buildStoryboardImagePrompt(
      theme,
      scenes,
      styleInstruction,
      aspectDirective
    );
    if (hasThemeReference) {
      imagePrompt += `\n\nA visual theme reference image is provided as the first reference. Match its color palette, mood, lighting, composition style, and overall aesthetic across all six panels while illustrating the scenes above.`;
    }
    // @-mention guidance: tell the model the provided reference images depict the
    // named subjects so the storyboard panels feature them consistently.
    const subjectRefs = mentionRefs.filter((r) => r.name !== "Theme");
    if (subjectRefs.length) {
      const list = subjectRefs.map((r) => `@${r.name} (${r.kind})`).join(", ");
      const many = subjectRefs.length > 1;
      imagePrompt += `\n\nThe theme references ${list}; matching reference image${many ? "s are" : " is"} provided. Use ${many ? "them" : "it"} as the visual reference for ${many ? "those subjects" : "that subject"} across the panels, preserving appearance and identity.`;
    }

    const inputImages: string[] = [];
    if (hasThemeReference && referenceFile) {
      await beginStep("reference_upload", "Upload theme reference to Replicate");
      console.log("[Storyboard] Uploading theme reference image to Replicate...");
      const themeRefUrl = await uploadProductImageToReplicate(replicate!, referenceFile);
      inputImages.push(themeRefUrl);
      await endStep({ themeRefUrl });
    }
    inputImages.push(...mentionReferenceUrls.slice(0, MAX_INPUT_IMAGES - inputImages.length));

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    await beginStep(
      "image_generation",
      "GPT Image storyboard sheet",
      assembledModelStepInput(imagePrompt),
    );
    console.log(`[Storyboard] Calling ${imageModelRef} from scene breakdown...`);
    const imageResult = await runReplicateWithRetry(
      replicate!,
      imageModelRef,
      {
        input: {
          prompt: imagePrompt,
          aspect_ratio: "3:2",
          output_format: "png",
          number_of_images: 1,
          quality: "auto",
          background: "opaque",
          moderation: "auto",
          ...(inputImages.length ? { input_images: inputImages } : {}),
        },
      },
      10,
      replicateHooks,
    );

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    const rawUrl = extractMediaUrl(imageResult);
    if (!rawUrl || !rawUrl.startsWith("http")) {
      console.error("[Storyboard] Unexpected gpt-image-2 output:", imageResult);
      throw new Error("Failed to resolve storyboard image URL from model output.");
    }
    await endStep({ imageUrl: rawUrl });

    if (generationRequestId && profileId) {
      await markProviderCommitted({
        generationRequestId,
        profileId,
        reason: "storyboard_image_generation",
      });
    }

    console.log("[Storyboard] Downloading image from Replicate...");
    const imgRes = await fetch(rawUrl);
    if (!imgRes.ok) {
      throw new Error(
        `Failed to download storyboard image: ${imgRes.status} ${imgRes.statusText}`
      );
    }
    imageBuffer = await imgRes.arrayBuffer();
    }

    await beginStep("storage_upload", devBlank ? "Save blank placeholder storyboard" : "Download storyboard image + upload to Supabase");
    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }
    const filename = `image_${Date.now()}.png`;
    const storagePath = storyboardSheetPath(userId!, filename);
    const supabase = getSupabase();

    console.log("[Storyboard] Uploading to Supabase:", storagePath);
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: "image/png",
        cacheControl: MEDIA_CACHE_CONTROL,
        upsert: false,
      });

    if (uploadError) {
      console.error("[Storyboard] Upload error:", uploadError);
      throw new Error(`Failed to upload storyboard: ${uploadError.message}`);
    }

    const { url: storyboardUrl } = await signStoragePathForUser(storagePath, userId!, "ui");
    await endStep({ storagePath, publicUrl: storyboardUrl });

    const scene_breakdown = { scenes };

    console.log("[Storyboard] Inserting row into", STORYBOARDS_TABLE);
    const { data: inserted, error: insertError } = await supabase
      .from(STORYBOARDS_TABLE)
      .insert({
        theme,
        storyboard_url: storagePath,
        seedance_prompt: seedancePrompt,
        scene_breakdown,
        storyboard_style: storyboardStyle,
        aspect_ratio: aspectRatio,
        language,
        status: "ready",
        user_id: userId,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      console.error("[Storyboard] DB insert error:", insertError);
      throw new Error(insertError?.message || "Failed to save storyboard record.");
    }

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    // Attach storyboardId into the asset metadata only AFTER the legacy storyboards
    // insert succeeds, then mark the image asset ready and finish the job.
    // costCredits on both is a display snapshot — credit_transactions is the truth.
    if (imageAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, imageAssetId!, {
        storagePath,
        mimeType: "image/png",
        costCredits: creditsAmount,
        metadata: { storyboardId: inserted.id, storyboardStyle, aspectRatio, language, theme: theme.slice(0, 200) },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { storyboardId: inserted.id, storyboardUrl, storagePath, assetId: imageAssetId },
        costCredits: creditsAmount,
      }));
    }

    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: "product_photo",
        mediaType: "image",
        mediaUrl: storagePath,
        storagePath,
        title: theme.slice(0, 200),
        metadata: {
          mode: "storyboard",
          storyboardId: inserted.id,
          storyboardStyle,
          aspectRatio,
          language,
          prompt: theme,
          userPrompt: theme,
          providerModel: devBlank ? "dev_blank" : imageModel.model,
          modelLabel: devBlank ? "Dev blank" : labelForProviderModel(imageModel.model),
          ...(devBlank ? devBlankJobTag() : {}),
        },
      });
    } catch (historyErr) {
      console.warn("[Storyboard] History log failed:", historyErr);
    }

    console.log("[Storyboard] Done:", storyboardUrl, "id:", inserted.id);
    const successResponse = {
      storyboardId: inserted.id,
      storyboardUrl,
      aspectRatio,
      language,
      historyItem,
    };

    // Usage event — analytics only, NEVER affects billing/response.
    await finishMeteredAttempt(metered, {
      kind: "success",
      responseJson: successResponse,
      primaryAssetId: imageAssetId,
      usage: {
        assetId: imageAssetId,
        tool: "photo",
        provider: devBlank ? "dev_blank" : imageModel.provider,
        model: devBlank ? "dev_blank" : imageModel.model,
        unitType: "images",
        units: 1,
        creditsCharged: creditsAmount,
        metadata: {
          mode: "storyboard",
          jobType: "storyboard_image",
          storyboardStyle,
          aspectRatio,
          language,
          storyboardId: inserted.id,
        },
      },
    });
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    const pricingMissing = error instanceof PricingConfigError;
    const rawMessage =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    if (cancelled) console.log("[Storyboard] Cancelled by user.");
    else console.error("[Storyboard] Error:", error);
    const handle =
      metered ??
      (profileId
        ? {
            profileId,
            userId: null,
            jobId,
            generationRequestId,
            creditsSpent,
            creditsAmount,
            assetIds: imageAssetId ? [imageAssetId] : [],
            refundJobType: "storyboard_image",
          }
        : null);
    if (handle) {
      const finished = await finishMeteredAttempt(handle, {
        kind: "terminal",
        cancelled,
        pricingMissing,
        rawMessage,
        currentStepId,
        clearCurrentStep: () => {
          currentStepId = null;
        },
      });
      if (finished.http) {
        return NextResponse.json(finished.http.body, { status: finished.http.status });
      }
    }
    return NextResponse.json({ error: rawMessage }, { status: 500 });
  }
}
