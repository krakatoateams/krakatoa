import { NextResponse } from "next/server";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import { isCancellation } from "@/lib/replicate-server";
import { makeReplicateCancelHooks, assertNotCancelled } from "@/lib/generation-cancel";
import { markProviderCommitted, isRefundableUserCancellation } from "@/lib/generation-commit";
import { createPipelineRecoveryHandle } from "@/lib/pipeline-recovery/handle";
import {
  checkpointRemoteVideo,
  markRecoverableIfArtifacts,
} from "@/lib/pipeline-recovery/video-upload-recovery";
import { RecoverablePipelineError } from "@/lib/pipeline-recovery/errors";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { insertUserCreation, getUserCreationForUser } from "@/lib/creations-db";
import { finishJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep } from "@/lib/job-steps-db";
import {
  beginMeteredAttempt,
  finishMeteredAttempt,
  type MeteredAttemptHandle,
} from "@/lib/metered-generation/lifecycle";
import {
  markAssetReady,
  findAssetByStoragePath,
} from "@/lib/assets-db";
import { createAssetRelation } from "@/lib/asset-relations-db";
import { getVideoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { resolveModel, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { isCatalogModelEnabled } from "@/lib/model-catalog-configs-db";
import { supabaseServer } from "@/lib/supabase-server";
import {
  MEDIA_CACHE_CONTROL,
  STORAGE_BUCKET,
  videosGeneratedVideoPath,
  isVideosTempRefPath,
} from "@/lib/storage-buckets";
import { resolveRefForPipeline, signStoragePathForUser } from "@/lib/storage-signed-url";
import {
  getVideoModel,
  isValidVideoModelId,
  isValidVideoResolution,
  isValidVideoAspectRatio,
  getAllowedDurations,
  validateVideoReferences,
  buildVideoProviderInput,
  getVideoJobKind,
  adaptViralTemplatePromptForModel,
  supportsViralTemplateGeneration,
  viralTemplateUsesCharacterImageOnly,
  type VideoJobKind,
  type VideoReferenceInputs,
  type VideoResolution,
} from "@/lib/video-models";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
} from "@/lib/generation-idempotency";
import {
  buildMentionGuidanceSuffix,
  mapMentionsToImageTokens,
  type MentionRef,
} from "@/lib/mention-assets";
import { resolveMentionCreations } from "@/lib/mention-assets-server";
import { getViralTemplate, isViralTemplateAssetPath, isViralTemplateId, viralTemplateLabel } from "@/lib/trending-templates";
import {
  rewriteViralTemplateFirstFrameUrl,
  viralTemplateAssetUrlForProvider,
} from "@/lib/viral-template-pipeline";
import { resolveLiveSkill } from "@/lib/skill-configs-db";
import {
  assembleSkillPrompt,
  skillDefaultTitle,
} from "@/lib/skills";
import {
  DevBlankForbiddenError,
  devBlankJobTag,
  isDevBlankRequested,
  readBlankVideoBytes,
  requireDevBlankAccess,
} from "@/lib/dev-blank-generation";

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
  if (!Array.isArray(raw) || max <= 0) return [];
  const out: RefAttachment[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    const ref = parseRefAttachment(item);
    if (ref) out.push(ref);
  }
  return out;
}

function parseCreationIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function resolveVideoRefsForPipeline(
  userId: string,
  refs: {
    firstFrame: RefAttachment | null;
    lastFrame: RefAttachment | null;
    referenceImages: RefAttachment[];
    referenceVideos: RefAttachment[];
    referenceAudios: RefAttachment[];
  }
): Promise<{ ok: true; inputs: VideoReferenceInputs } | { ok: false; error: string }> {
  const resolveOne = async (ref: RefAttachment | null): Promise<string | null> => {
    if (!ref) return null;
    return resolveRefForPipeline(userId, ref);
  };
  const resolveMany = async (list: RefAttachment[]): Promise<string[] | null> => {
    const urls: string[] = [];
    for (const ref of list) {
      const url = await resolveRefForPipeline(userId, ref);
      if (!url) return null;
      urls.push(url);
    }
    return urls;
  };

  const firstFrame = await resolveOne(refs.firstFrame);
  const lastFrame = await resolveOne(refs.lastFrame);
  if (refs.firstFrame && !firstFrame) {
    return { ok: false, error: "First frame could not be resolved." };
  }
  if (refs.lastFrame && !lastFrame) {
    return { ok: false, error: "Last frame could not be resolved." };
  }
  const referenceImages = await resolveMany(refs.referenceImages);
  if (referenceImages === null) {
    return { ok: false, error: "A reference image could not be resolved." };
  }
  const referenceVideos = await resolveMany(refs.referenceVideos);
  if (referenceVideos === null) {
    return { ok: false, error: "A reference video could not be resolved." };
  }
  const referenceAudios = await resolveMany(refs.referenceAudios);
  if (referenceAudios === null) {
    return { ok: false, error: "A reference audio could not be resolved." };
  }
  return {
    ok: true,
    inputs: { firstFrame, lastFrame, referenceImages, referenceVideos, referenceAudios },
  };
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
  let metered: MeteredAttemptHandle | null = null;
  let userId: string | null = null;
  let pipelineRecovery: ReturnType<typeof createPipelineRecoveryHandle> | undefined;
  let jobKind: VideoJobKind = "video_text2video";
  let jobLabel = "Text to Video";
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
    const skillIdRaw = typeof b.skillId === "string" ? b.skillId.trim() : "";
    const liveSkill = skillIdRaw ? await resolveLiveSkill(skillIdRaw, profileId) : null;
    if (skillIdRaw) {
      if (!liveSkill || liveSkill.mediaType !== "video" || liveSkill.openHref) {
        return NextResponse.json({ error: "Unknown video skill." }, { status: 400 });
      }
      try {
        await assertToolEnabled("skills");
      } catch (e) {
        if (e instanceof ToolDisabledError) {
          return NextResponse.json(
            { error: e.message, code: "TOOL_DISABLED" },
            { status: 403 }
          );
        }
        console.warn("[video] skills tool guard unexpected error (failing open):", e);
      }
    }
    const skillId = liveSkill?.id;
    const devBlank = isDevBlankRequested(b);
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

    const promptRaw = String(b.prompt ?? "").trim();
    const modelId = String(b.modelId ?? "").trim();
    const duration = Number(b.duration ?? NaN);
    const resolution = String(b.resolution ?? "").trim();
    const aspectRatio = String(b.aspectRatio ?? "").trim();
    const generateAudio = b.generateAudio === true;
    const seedRaw = b.seed;
    const seed =
      typeof seedRaw === "number" && Number.isFinite(seedRaw) ? Math.trunc(seedRaw) : null;
    const referenceCreationIds = parseCreationIdList(b.referenceCreationIds);
    const viralTemplateId =
      typeof b.viralTemplateId === "string" ? b.viralTemplateId.trim() : "";
    const viralTemplateStartFramePath =
      typeof b.viralTemplateStartFramePath === "string"
        ? b.viralTemplateStartFramePath.trim()
        : "";
    const startImageCreationId =
      typeof b.startImageCreationId === "string" ? b.startImageCreationId.trim() : "";
    const endImageCreationId =
      typeof b.endImageCreationId === "string" ? b.endImageCreationId.trim() : "";

    // ---- Validate model + options (all before any job/spend/provider) ----
    if (!modelId || !isValidVideoModelId(modelId)) {
      return NextResponse.json({ error: "Unknown video model." }, { status: 400 });
    }
    const model = getVideoModel(modelId);
    if (!(await isCatalogModelEnabled("reels", modelId))) {
      return NextResponse.json({ error: "This model isn't available." }, { status: 400 });
    }
    jobKind = getVideoJobKind(model);
    jobLabel = jobKind === "video_image2video" ? "Image to Video" : "Text to Video";

    // Cap the prompt to the selected model's limit (e.g. Kling v3 = 2500 chars).
    const prompt = promptRaw.slice(0, model.promptMaxChars ?? PROMPT_MAX_CHARS);

    if (!prompt && (!liveSkill || liveSkill.promptRequired)) {
      return NextResponse.json(
        { error: "A prompt is required to generate a video." },
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
    // Duration is validated against the resolution (some models restrict durations
    // at certain resolutions — e.g. Veo 3.1 Lite only allows 8s at 1080p).
    const allowedDurations = getAllowedDurations(model, resolution as VideoResolution);
    if (!Number.isFinite(duration) || !allowedDurations.includes(duration)) {
      return NextResponse.json(
        {
          error: `Duration must be one of: ${allowedDurations.join(", ")} seconds for ${resolution}.`,
        },
        { status: 400 }
      );
    }

    const isViralTemplateRun =
      (viralTemplateId.length > 0 && isViralTemplateId(viralTemplateId)) ||
      (viralTemplateStartFramePath.length > 0 &&
        isViralTemplateAssetPath(viralTemplateStartFramePath));
    const grokViral =
      isViralTemplateRun && viralTemplateUsesCharacterImageOnly(model);

    // ---- Parse reference attachments + collect their temp paths for cleanup ----
    const refsRaw = (b.references ?? {}) as Record<string, unknown>;
    let firstFrame = parseRefAttachment(refsRaw.firstFrame);
    let lastFrame = parseRefAttachment(refsRaw.lastFrame);
    const refImageCap =
      isViralTemplateRun && model.references.referenceImages === 0 ? 1 : model.references.referenceImages;
    let referenceImages = parseRefList(refsRaw.referenceImages, refImageCap);
    const referenceVideos = parseRefList(refsRaw.referenceVideos, model.references.referenceVideos);
    const referenceAudios = parseRefList(refsRaw.referenceAudios, model.references.referenceAudios);

    // Library-picked start image (owner-scoped; no temp path to sweep).
    if (startImageCreationId && userId) {
      const resolved = await resolveMentionCreations(userId, [startImageCreationId]);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      if (!firstFrame) {
        firstFrame = { url: resolved.items[0].url, path: "" };
      }
    }

    if (endImageCreationId && userId) {
      const resolved = await resolveMentionCreations(userId, [endImageCreationId]);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      if (!lastFrame) {
        lastFrame = { url: resolved.items[0].url, path: "" };
      }
    }

    const uploadedRefImageCount = referenceImages.length;
    let mentionRefs: MentionRef[] = [];
    if (referenceCreationIds.length && userId) {
      const resolved = await resolveMentionCreations(userId, referenceCreationIds);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      mentionRefs = resolved.items.map((item) => item.ref);
      const mentionUrls = resolved.items.map((item) => item.url);
      if (model.references.referenceImages > 0) {
        for (const url of mentionUrls) {
          if (referenceImages.length >= model.references.referenceImages) break;
          if (!referenceImages.some((r) => r.url === url)) {
            referenceImages.push({ url, path: "" });
          }
        }
      } else if (model.references.firstFrame && !firstFrame && mentionUrls[0]) {
        firstFrame = { url: mentionUrls[0], path: "" };
      }
    }

    if (isViralTemplateRun) {
      if (!supportsViralTemplateGeneration(model)) {
        return NextResponse.json(
          {
            error:
              "This model does not support Viral template. Pick Seedance 2, Kling v1.6+, or Grok Imagine Video in the Viral template admin matrix.",
            code: "VIRAL_TEMPLATE_MODEL_UNSUPPORTED",
          },
          { status: 400 }
        );
      }

      if (grokViral) {
        const hasCharacterRef =
          referenceImages.length > 0 ||
          referenceCreationIds.length > 0 ||
          Boolean(firstFrame?.url);
        if (!hasCharacterRef) {
          return NextResponse.json(
            { error: "Viral template requires a character reference image." },
            { status: 400 }
          );
        }
        if (!firstFrame?.url && referenceImages.length > 0) {
          firstFrame = referenceImages[0];
          referenceImages = referenceImages.slice(1);
        }
      } else {
        if (viralTemplateStartFramePath) {
          const providerUrl = viralTemplateAssetUrlForProvider(viralTemplateStartFramePath);
          if (!providerUrl) {
            return NextResponse.json(
              { error: "Invalid viral template start frame." },
              { status: 400 }
            );
          }
          firstFrame = { url: providerUrl, path: "" };
        } else if (firstFrame?.url) {
          const rewritten = rewriteViralTemplateFirstFrameUrl(firstFrame.url);
          if (rewritten) firstFrame = { url: rewritten, path: firstFrame.path };
        }

        const hasCharacterRef =
          referenceImages.length > 0 || referenceCreationIds.length > 0;
        if (!hasCharacterRef) {
          return NextResponse.json(
            { error: "Viral template requires a character reference image." },
            { status: 400 }
          );
        }
      }
    } else if (firstFrame?.url) {
      const rewritten = rewriteViralTemplateFirstFrameUrl(firstFrame.url);
      if (rewritten) firstFrame = { url: rewritten, path: firstFrame.path };
    }

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

    const refCheck = validateVideoReferences(model, referenceInputs, { resolution, generateAudio });
    if (!refCheck.ok) {
      return NextResponse.json({ error: refCheck.error }, { status: 400 });
    }

    if (
      liveSkill?.inputs.some((slot) => slot.key === "startFrame" && slot.required) &&
      !referenceInputs.firstFrame
    ) {
      return NextResponse.json(
        { error: "A start frame is required for this skill." },
        { status: 400 }
      );
    }

    let providerPrompt = prompt;
    if (skillId) {
      providerPrompt = assembleSkillPrompt(skillId, prompt, liveSkill?.recipe);
    }
    if (isViralTemplateRun) {
      providerPrompt = adaptViralTemplatePromptForModel(providerPrompt, model);
    }
    if (mentionRefs.length > 0) {
      if (model.references.referenceImages > 0) {
        providerPrompt = mapMentionsToImageTokens(
          providerPrompt,
          mentionRefs,
          uploadedRefImageCount
        );
      }
      providerPrompt = `${providerPrompt}${buildMentionGuidanceSuffix(mentionRefs)}`.trim();
    }

    // Variant-aware pricing: Seedance keys off resolution + reference video
    // ("video_in"); Veo 3.1 Fast keys off audio.
    const hasReferenceVideo = referenceVideos.length > 0;
    const pricingKey = model.pricingKey({ resolution, hasReferenceVideo, generateAudio });

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
      referenceCreationIds: referenceCreationIds.join(","),
      startImageCreationId,
      endImageCreationId,
      skillId: skillId ?? "",
      devBlank,
    });
    const requiredCredits = devBlank
      ? 0
      : await getVideoCredits({ pricingKey, durationSec: duration });
    const beginResult = await beginMeteredAttempt({
      profileId: profileId!,
      userId,
      idempotency: {
        key: idemKey,
        routeKey: "generate_video",
        toolKey: "reels",
        requestHash,
      },
      job: {
        tool: "reels",
        jobType: jobKind,
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        input: {
          userId: userId!,
          modelId,
          duration,
          resolution,
          aspectRatio,
          generateAudio,
          pricingKey,
          prompt,
          ...(skillId ? { skillId } : {}),
          ...(devBlank ? devBlankJobTag() : {}),
        },
      },
      spend: {
        amount: requiredCredits,
        jobType: jobKind,
        description: `${jobLabel} generation`,
        metadata: {
          tool: "reels",
          jobType: jobKind,
          modelId,
          duration,
          resolution,
          aspectRatio,
          generateAudio,
          pricingKey,
          providerModel: resolvedModel.model,
        },
        skip: devBlank,
      },
      processingAssets: [
        {
          tool: "reels",
          assetType: "video",
          role: jobKind,
          provider: resolvedModel.provider,
          model: resolvedModel.model,
          metadata: { modelId, duration, resolution, aspectRatio, generateAudio, pricingKey },
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
    videoAssetId = metered.assetIds[0] ?? null;
    if (jobId && userId) {
      pipelineRecovery = createPipelineRecoveryHandle({
        profileId: profileId!,
        userId: userId!,
        jobId,
      });
    }

    let videoBuffer: Buffer;
    const videoMode = jobKind === "video_image2video" ? "i2v" : "t2v";

    if (devBlank) {
      await beginStep("dev_blank", "Deliver blank placeholder video (admin test)");
      videoBuffer = await readBlankVideoBytes(aspectRatio);
      await endStep({ devBlank: true });
    } else {
      const pipelineRefs = await resolveVideoRefsForPipeline(userId!, {
        firstFrame,
        lastFrame,
        referenceImages,
        referenceVideos,
        referenceAudios,
      });
      if (!pipelineRefs.ok) {
        throw new Error(pipelineRefs.error);
      }

      const replicate = createReplicateClient();
      const providerInput = buildVideoProviderInput({
        model,
        prompt: providerPrompt,
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        seed,
        references: pipelineRefs.inputs,
        viralTemplateMode: isViralTemplateRun && !grokViral,
      });

      await beginStep("video_generation", `${model.modelLabel} ${jobLabel.toLowerCase()} generation`, {
        duration,
        resolution,
        aspectRatio,
      });
      if (generationRequestId && profileId) {
        await assertNotCancelled(profileId, generationRequestId);
      }
      console.log(
        `[${jobLabel}] Running ${modelRef} (duration=${duration}s, resolution=${resolution}, aspect=${aspectRatio})...`
      );
      const output = await runWithRetry(
        replicate,
        modelRef,
        { input: providerInput },
        10,
        makeReplicateCancelHooks({
          generationRequestId,
          profileId,
          jobId,
          kind: jobKind,
        }),
      );

      if (generationRequestId && profileId) {
        await assertNotCancelled(profileId, generationRequestId);
      }

      const generatedVideoUrl = extractMediaUrl(output);
      if (!generatedVideoUrl.startsWith("http")) {
        throw new Error("Video model did not return a valid video URL");
      }
      await endStep({ generatedVideoUrl });

      if (generationRequestId && profileId) {
        await markProviderCommitted({
          generationRequestId,
          profileId,
          reason: "video_generation",
        });
      }

      await checkpointRemoteVideo(
        pipelineRecovery,
        generatedVideoUrl,
        `source_${Date.now()}.mp4`,
        "video",
      );

      await beginStep("storage_upload", "Download generated video + save to Supabase");
      if (generationRequestId && profileId) {
        await assertNotCancelled(profileId, generationRequestId);
      }
      const videoResponse = await fetch(generatedVideoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
      }
      videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await endStep({ downloaded: true });
    }

    const storagePath = videosGeneratedVideoPath(userId!, videoMode, `video_${Date.now()}.mp4`);

    if (!devBlank) {
      if (generationRequestId && profileId) {
        await assertNotCancelled(profileId, generationRequestId);
      }
    } else {
      await beginStep("storage_upload", "Save blank placeholder video to Supabase");
    }
    const { error: uploadError } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, videoBuffer, {
        contentType: "video/mp4",
        cacheControl: MEDIA_CACHE_CONTROL,
        upsert: false,
      });
    if (uploadError) {
      throw new RecoverablePipelineError(
        `Failed to save video to storage: ${uploadError.message}`,
        "upload",
      );
    }
    const { url: publicUrl } = await signStoragePathForUser(storagePath, userId!, "ui");
    await endStep({ storagePath, publicUrl });

    const viralTemplateMeta =
      isViralTemplateRun && viralTemplateId
        ? getViralTemplate(viralTemplateId)
        : undefined;
    const title =
      isViralTemplateRun && viralTemplateMeta
        ? viralTemplateLabel(viralTemplateMeta)
        : skillId
          ? prompt.slice(0, 60) || skillDefaultTitle(skillId, liveSkill?.title)
          : prompt.slice(0, 60) || jobLabel;
    const creationMetadata = {
      ...(isViralTemplateRun && viralTemplateId
        ? {
            viralTemplateId,
            ...(viralTemplateMeta
              ? { viralTemplateTitle: viralTemplateLabel(viralTemplateMeta) }
              : {}),
          }
        : { prompt, userPrompt: prompt }),
      ...(skillId ? { skillId } : {}),
      modelId,
      modelLabel: model.modelLabel,
      providerModel: devBlank ? "dev_blank" : resolvedModel.model,
      duration,
      resolution,
      aspectRatio,
      generateAudio,
      pricingKey,
      ...(devBlank ? devBlankJobTag() : {}),
    };

    // user_creations row (history + sweep reference). Owner = users.id (user_id).
    let historyItem = null;
    if (userId) {
      historyItem = await safe("insertUserCreation", () =>
        insertUserCreation({
          userId: userId!,
          tool: jobKind,
          mediaType: "video",
          mediaUrl: storagePath,
          storagePath,
          title,
          metadata: creationMetadata,
        })
      );
    }

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }
    if (videoAssetId && profileId) {
      await safe("markAssetReady", () =>
        markAssetReady(profileId!, videoAssetId!, {
          storagePath,
          mimeType: "video/mp4",
          durationSec: duration,
          costCredits: creditsAmount,
          metadata: creationMetadata,
        })
      );
    }
    // Lineage for the Photo → video hand-off: link the library photo that seeded
    // this clip to the clip itself, so the source is recoverable from either end.
    // ponytail: start frame only — end frames and @-mentions are additional
    // inputs, not the source. Widen the same block if that ever matters.
    if (startImageCreationId && videoAssetId && profileId && userId) {
      await safe("linkSourceImage", async () => {
        const creation = await getUserCreationForUser(userId!, startImageCreationId);
        if (!creation?.storagePath) return;
        const imageAsset = await findAssetByStoragePath(profileId!, creation.storagePath);
        // Only an image can be the source of a clip. Guards the relation graph
        // against a client sending a video creation id as the start frame.
        if (imageAsset?.asset_type !== "image") return;
        await createAssetRelation({
          profileId: profileId!,
          parentAssetId: imageAsset.id,
          childAssetId: videoAssetId!,
          relationType: "source_for",
          metadata: { creationId: startImageCreationId },
        });
      });
    }

    if (jobId && profileId) {
      await safe("finishJob", () =>
        finishJob(profileId!, jobId!, {
          output: { videoUrl: publicUrl, storagePath, assetId: videoAssetId },
          costCredits: creditsAmount,
        })
      );
    }

    const successResponse = {
      videoUrl: publicUrl,
      storagePath,
      historyItem,
      savedToCloud: true,
      devBlank,
    };
    await finishMeteredAttempt(metered, {
      kind: "success",
      responseJson: successResponse,
      primaryAssetId: videoAssetId,
      usage: {
        assetId: videoAssetId,
        tool: "reels",
        provider: resolvedModel.provider,
        model: resolvedModel.model,
        unitType: "video_seconds",
        units: duration,
        creditsCharged: creditsAmount,
        metadata: { jobType: jobKind, modelId, resolution, aspectRatio, pricingKey },
      },
      purgeResumable: true,
    });
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const recoverableHandled =
      jobId &&
      profileId &&
      (await markRecoverableIfArtifacts({
        error,
        profileId: profileId!,
        jobId: jobId!,
        recovery: pipelineRecovery,
        finalAssetId: videoAssetId,
        errorJson: {
          message:
            error instanceof Error ? error.message : String(error),
          code: "PIPELINE_RECOVERABLE",
        },
      }));
    const recoverable = recoverableHandled || error instanceof RecoverablePipelineError;
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    const pricingMissing = error instanceof PricingConfigError;
    const rawMessage =
      error instanceof Error ? error.message : String(error);
    if (cancelled) console.log(`[${jobLabel}] Cancelled by user.`);
    else console.error(`[${jobLabel}] Error:`, error);
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
            assetIds: videoAssetId ? [videoAssetId] : [],
            refundJobType: jobKind,
          }
        : null);
    if (handle) {
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
              settlementOptions: { recoverableJobAction: "skip", resumablePurge: true },
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
              settlementOptions: { resumablePurge: true },
            },
      );
      if (finished.http) {
        return NextResponse.json(finished.http.body, { status: finished.http.status });
      }
    }
    return NextResponse.json({ error: rawMessage }, { status: 500 });
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
