import { NextResponse } from "next/server";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  ModelPoseId,
  PhotoStyleId,
  PRODUCT_PHOTO_BUCKET,
  DEFAULT_PRODUCT_PHOTO_TIER,
  normalizeProductPhotoOptions,
  productPhotoPricingKey,
  productPhotoProviderResolution,
  buildGeneratedFilename,
  photoStorageModeFromGenerate,
  buildProductPhotoPrompt,
  buildCharacterSheetPrompt,
  buildPhotoProviderInput,
  getProductPhotoTier,
  tierSupportsMultiReference,
  isValidPhotoAspectRatio,
  DEFAULT_PHOTO_ASPECT_RATIO,
  CHARACTER_CREATION_KIND,
  SOCIAL_POST_CREATION_KIND,
  buildSocialPostPrompt,
  isValidCharacterStyle,
  isValidCharacterGender,
  isValidCharacterAge,
  DEFAULT_CHARACTER_STYLE,
  DEFAULT_CHARACTER_GENDER,
  DEFAULT_CHARACTER_AGE,
} from "@/lib/product-photo";
import { saveGeneratedProductPhoto } from "@/lib/product-photo-storage";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import { isCancellation } from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob, cancelJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getProductPhotoCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getPhotoFeatureEnablement } from "@/lib/feature-model-configs-db";
import { getPhotoFeature } from "@/lib/creation-features";
import { getPhotoModel, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { resolveMentionCreations } from "@/lib/mention-assets-server";
import { buildMentionGuidanceSuffix } from "@/lib/mention-assets";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  attachGenerationRequestJob,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
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
  readBlankImageBytes,
  requireDevBlankAccess,
} from "@/lib/dev-blank-generation";
import { handlePhotoStoryboardGeneration } from "@/lib/photo-storyboard-generation";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Optional free-text creative direction (omni-form at /tools/photo-v2). Capped so a
// runaway client value can't bloat the provider prompt; empty when not supplied.
const PROMPT_MAX_CHARS = 1500;
// Max @-mentioned assets (saved characters / storyboards) used as references.
const MAX_MENTIONS = 8;
// Social media post can generate a batch of alternatives in one request. Every
// image is a separate provider call and is charged separately.
const MAX_BATCH_IMAGES = 4;

function isValidPose(id: string): id is ModelPoseId {
  return MODEL_POSES.some((p) => p.id === id);
}

function isValidStyle(id: string): id is PhotoStyleId {
  return PHOTO_STYLES.some((s) => s.id === id);
}

/** Shared upload validation (type + size). Returns an error message or null. */
function validateImageUpload(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Only JPEG, PNG, or WebP images are supported";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Image must be 10MB or smaller";
  }
  return null;
}

export async function POST(req: Request) {
  // Platform-observability trackers — declared before the try so the catch block
  // can finalize whatever was created. They stay null when observability is
  // skipped, making every platform write a guarded no-op.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let photoAssetId: string | null = null;
  // Batch generations create one asset row per image; `photoAssetId` stays the
  // first one so single-image bookkeeping is unchanged.
  const photoAssetIds: string[] = [];
  let photoAssetsFinalized = false;
  // Credit-spend trackers — used by the catch block to issue a best-effort
  // refund when generation fails after a successful spend. `creditsSpent` is
  // the gate; without it the catch block must NOT refund (no spend = no debt).
  let creditsSpent = false;
  let creditsAmount = 0;
  // Request-level idempotency row id (Double-Charge Protection v1).
  let generationRequestId: string | null = null;

  // Best-effort wrapper: platform writes must NEVER crash generation or mask the
  // original error.
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[photo obs] ${label} failed:`, e);
      return null;
    }
  };

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

  try {
    // STRICT profile resolution — this route now charges credits, so we MUST
    // have a profileId. The previous "continue legacy-only on infra failure"
    // fallback has been removed: free generation is unacceptable for a route
    // that costs credits. Unauthenticated still returns 401; anything else is
    // a 500 so the client/operator can see the real failure.
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
    //   profile.user_id -> legacy storage path + user_creations (= users.id)
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[photo] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // ---- Tool-access guard (Admin Phase 2) ----
    // Runs before any job/credit/provider work. Returns 403 only when an admin
    // has explicitly disabled this tool; missing config / DB errors fail open.
    try {
      await assertToolEnabled("photo");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[photo] tool guard unexpected error (failing open):", e);
    }

    const formData = await req.formData();
    const modeRaw = String(formData.get("mode") || "product").trim();
    if (modeRaw === "storyboard") {
      return handlePhotoStoryboardGeneration(req, { formData });
    }

    const devBlank = isDevBlankFormValue(formData.get(DEV_BLANK_REQUEST_KEY));
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
    const file = formData.get("image");
    // Optional extra reference images (omni-form /tools/photo-v2):
    //   - Product Try-on: `character` — an optional model/person image alongside
    //     the required product image.
    //   - Generate any image: `reference` — an optional reference image used only
    //     by reference-capable models.
    const characterFile = formData.get("character");
    const referenceFile = formData.get("reference");
    // Product Try-on can use a previously generated character (by creation id)
    // instead of an uploaded character image. Resolved to the creation's image URL
    // (owner-scoped) and passed as an extra reference — no re-upload needed.
    const characterCreationId = String(formData.get("characterCreationId") || "").trim();
    // @-mentions (omni-form): comma-separated creation ids the user tagged with
    // "@" in the prompt (saved characters / storyboards). Each is resolved
    // owner-scoped to its image URL and passed as an extra reference, and the
    // prompt gets guidance naming them. Capped to keep the provider input sane.
    const referenceCreationIds = String(formData.get("referenceCreationIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_MENTIONS);
    const poseId = String(formData.get("poseId") || "").trim();
    const styleId = String(formData.get("styleId") || "").trim();
    // Product Photo v2.3: model tier + optional resolution.
    //   basic    -> google/nano-banana      (no resolution param)
    //   balanced -> google/nano-banana-2     (resolution 1K/2K/4K)
    //   pro      -> google/nano-banana-pro   (resolution 1K/2K/4K)
    const modelTierRaw = String(formData.get("modelTier") || "").trim() || DEFAULT_PRODUCT_PHOTO_TIER;
    const resolutionRaw = String(formData.get("resolution") || "").trim();
    // Optional user prompt from the omni-form. Trim + hard-cap; "" means none.
    const userPrompt = String(formData.get("prompt") || "")
      .trim()
      .slice(0, PROMPT_MAX_CHARS);
    // Generation mode (omni-form /tools/photo-v2):
    //   - "product"   (default): requires a product reference image; the prompt is
    //                  wrapped in product-photography scaffolding.
    //   - "image"     : text-to-image; prompt required, used verbatim; no product.
    //   - "character" : text-to-image turnaround sheet (one image, multiple angles);
    //                  prompt or reference required; optional character name.
    //   - "social"    : text-to-image Instagram feed post; prompt required, wrapped
    //                  in social-composition scaffolding; 1:1 or 4:5.
    //   - "storyboard": handled above via handlePhotoStoryboardGeneration.
    const mode: "product" | "image" | "character" | "social" =
      modeRaw === "image" || modeRaw === "character" || modeRaw === "social"
        ? modeRaw
        : "product";
    const requiresProductImage = mode === "product";
    const isCharacterMode = mode === "character";
    const isSocialMode = mode === "social";
    // Batch size — only Social media post offers alternatives; every other mode
    // produces exactly one image. Clamped so a forged client value can't fan out.
    const imageCountRaw = Number.parseInt(String(formData.get("imageCount") || "1"), 10);
    const imageCount = isSocialMode
      ? Math.min(Math.max(Number.isFinite(imageCountRaw) ? imageCountRaw : 1, 1), MAX_BATCH_IMAGES)
      : 1;
    // Optional character name (Character creation). Trimmed + capped.
    const characterName = String(formData.get("characterName") || "").trim().slice(0, 80);
    // Character creation descriptors (validated; fall back to defaults). Style =
    // art style (realistic / 3D / pixel / …); gender + age (life-stage words).
    const characterStyleRaw = String(formData.get("style") || "").trim();
    const characterGenderRaw = String(formData.get("gender") || "").trim();
    const characterAgeRaw = String(formData.get("age") || "").trim();
    const characterStyle = isValidCharacterStyle(characterStyleRaw)
      ? characterStyleRaw
      : DEFAULT_CHARACTER_STYLE;
    const characterGender = isValidCharacterGender(characterGenderRaw)
      ? characterGenderRaw
      : DEFAULT_CHARACTER_GENDER;
    const characterAge = isValidCharacterAge(characterAgeRaw)
      ? characterAgeRaw
      : DEFAULT_CHARACTER_AGE;
    // Aspect ratio chip (omni-form). Validated against the provider-supported enum;
    // anything unknown falls back to the default so a bad client value can't error.
    const aspectRatioRaw = String(formData.get("aspectRatio") || "").trim();
    const aspectRatio = isValidPhotoAspectRatio(aspectRatioRaw)
      ? aspectRatioRaw
      : DEFAULT_PHOTO_ASPECT_RATIO;

    if (requiresProductImage) {
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Product image file is required" }, { status: 400 });
      }
      const fileErr = validateImageUpload(file);
      if (fileErr) {
        return NextResponse.json({ error: fileErr }, { status: 400 });
      }
    } else if (isCharacterMode) {
      // Character creation: need a description and/or a reference image to define
      // the character.
      if (!userPrompt && !(referenceFile instanceof File)) {
        return NextResponse.json(
          { error: "Describe your character or attach a reference image." },
          { status: 400 }
        );
      }
    } else {
      // Text-to-image: the prompt carries the full intent.
      if (!userPrompt) {
        return NextResponse.json(
          { error: "A prompt is required to generate an image." },
          { status: 400 }
        );
      }
    }

    // Pose/style are product-photo concepts. The omni-form always sends valid
    // defaults (even in image mode), so we validate unconditionally — this also
    // narrows poseId/styleId for the shared metadata/storage code below.
    if (!isValidPose(poseId)) {
      return NextResponse.json({ error: "Invalid model pose" }, { status: 400 });
    }

    if (!isValidStyle(styleId)) {
      return NextResponse.json({ error: "Invalid photo style" }, { status: 400 });
    }

    // Validate/normalize tier + resolution. Basic ignores resolution (-> null);
    // balanced/pro require a valid 1k/2k/4k. Invalid tier or missing/invalid
    // resolution for a resolution-bearing tier -> 400 (before any job/spend/provider).
    const normalized = normalizeProductPhotoOptions({
      modelTier: modelTierRaw,
      resolution: resolutionRaw,
    });
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const { modelTier, resolution } = normalized;
    const tier = getProductPhotoTier(modelTier);
    // Product Try-on requires a reference-capable model. Text-to-image-only models
    // (e.g. Imagen 4, FLUX 1.1 Pro) can't consume the uploaded product image, so
    // reject before any job/spend/provider work. The omni-form already hides these
    // in product mode; this guards a stale/forged client value.
    if (requiresProductImage && !tier.supportsReference) {
      return NextResponse.json(
        {
          error: `${tier.modelLabel} doesn't support a product reference image. Choose a reference-capable model or use "Generate any image".`,
        },
        { status: 400 }
      );
    }

    // Per-feature model enablement (Admin Config v3). An admin can disable a model
    // for a specific feature; reject a disabled/ineligible tier before any
    // job/spend/provider work. The omni-form already hides disabled models; this
    // guards a stale or forged client value. Never throws — falls back to code
    // defaults (all eligible tiers enabled) when the DB is unavailable.
    const enablement = await getPhotoFeatureEnablement();
    if (!enablement[mode].enabledTiers.includes(modelTier)) {
      return NextResponse.json(
        {
          error: `${tier.modelLabel} isn't available for ${getPhotoFeature(mode).label}. Choose another model.`,
        },
        { status: 400 }
      );
    }

    // Optional extra reference images. Product Try-on can pass a character/model
    // image alongside the product; Generate any image / Character creation can pass a
    // single reference image (only for reference-capable models). Validated BEFORE any
    // job/spend so a bad file never charges credits. Text-only models ignore any
    // reference entirely.
    const extraReferenceFiles: File[] = [];
    // Reference image URLs that already exist (e.g. a saved character) and don't need
    // re-uploading — appended to the reference list after any uploaded files.
    const directReferenceUrls: string[] = [];
    if (requiresProductImage) {
      if (characterFile instanceof File) {
        const err = validateImageUpload(characterFile);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
        extraReferenceFiles.push(characterFile);
      } else if (characterCreationId && userId) {
        // Signed pipeline URL — Replicate must fetch a valid https URI (private bucket).
        const resolved = await resolveMentionCreations(userId, [characterCreationId]);
        if (!resolved.ok) {
          return NextResponse.json({ error: "Selected character could not be found." }, { status: 400 });
        }
        directReferenceUrls.push(resolved.items[0].url);
      }
    } else if (tier.supportsReference && referenceFile instanceof File) {
      const err = validateImageUpload(referenceFile);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      extraReferenceFiles.push(referenceFile);
    }

    // Product Try-on with a distinct character/model image. The references are sent
    // as [product, character]; the prompt is made role-aware below so the model
    // actually uses the selected person. (Single-image-model guard below covers the
    // case where the chosen model can't honor more than one reference.)
    const hasCharacterReference =
      requiresProductImage &&
      (extraReferenceFiles.length > 0 || directReferenceUrls.length > 0);

    // @-mentioned assets: resolve each tagged creation (saved character / storyboard)
    // owner-scoped to its image URL, append as references, and remember its name +
    // kind so the prompt can tell the model what each reference depicts.
    const mentionRefs: { name: string; kind: "character" | "storyboard" | "image" }[] = [];
    if (referenceCreationIds.length && userId) {
      // A mentioned asset is only usable by reference-capable models.
      if (!tier.supportsReference) {
        return NextResponse.json(
          {
            error: `${tier.modelLabel} can't use mentioned references. Choose a reference-capable model such as Nano Banana or Seedream 4.`,
          },
          { status: 400 }
        );
      }
      const resolved = await resolveMentionCreations(userId, referenceCreationIds);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      for (const item of resolved.items) {
        directReferenceUrls.push(item.url);
        mentionRefs.push(item.ref);
      }
    }

    // Single-image models (e.g. FLUX Kontext) can't honor more than one reference,
    // whether that's a Product Try-on character or @-mentioned assets. Reject before
    // any spend rather than silently dropping references.
    const totalReferenceImages =
      (requiresProductImage ? 1 : 0) + extraReferenceFiles.length + directReferenceUrls.length;
    if (totalReferenceImages > 1 && !tierSupportsMultiReference(tier)) {
      return NextResponse.json(
        {
          error: `${tier.modelLabel} can only use a single reference image. Choose Nano Banana or Seedream 4 to combine multiple references.`,
        },
        { status: 400 }
      );
    }

    const pricingKey = productPhotoPricingKey({ modelTier, resolution });
    const providerResolution = productPhotoProviderResolution(resolution);

    // ---- Resolve runtime model + pricing (Admin Phase 2 / Product Photo v2.3) ----
    // DB-backed per-tier model config with fallback to the built-in per-tier model
    // id. The SAME resolved model is reused for createJob, createProcessingAsset,
    // the provider call, and recordUsageEvent so observability never disagrees with
    // what actually ran.
    const photoModel = await getPhotoModel(modelTier);
    const photoModelRef = replicateRef(photoModel);

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    // MUST run before createJob, spendCredits, or any provider call. The key is
    // read from the `Idempotency-Key` HTTP header (works with multipart/form-data;
    // we never put the key inside FormData). v1 hashes metadata only — NOT the
    // uploaded file bytes — to avoid a second heavy read; the key is the primary
    // dedupe mechanism.
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({
      poseId,
      styleId,
      modelTier,
      resolution,
      pricingKey,
      providerModel: photoModel.model,
      providerResolution,
      userPrompt,
      mode,
      characterName,
      characterStyle,
      characterGender,
      characterAge,
      aspectRatio,
      imageCount,
      // Distinguish requests that add an optional character/reference image so a
      // retry with a different attachment set isn't treated as a replay.
      extraRefCount: extraReferenceFiles.length + directReferenceUrls.length,
      characterRef: characterCreationId,
      mentionRefs: referenceCreationIds.join(","),
      devBlank,
    });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_photo",
      toolKey: "photo",
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
    // Created after all input validation so validation early-returns never leave
    // a dangling job. The processing asset is intentionally deferred until AFTER
    // the credit spend succeeds, so the assets table never carries a processing
    // row for a request that was rejected for insufficient credits.
    const job = await safe("createJob", () => createJob({
      profileId: profileId!,
      tool: "photo",
      jobType: "product_photo",
      provider: photoModel.provider,
      model: photoModel.model,
      // `prompt` is what the user typed; the assembled prompt actually sent to the
      // model is recorded on the image_generation step, since it is built later.
      input: {
        poseId,
        styleId,
        modelTier,
        resolution,
        pricingKey,
        mode,
        imageCount,
        ...(userPrompt ? { prompt: userPrompt } : {}),
        ...(devBlank ? devBlankJobTag() : {}),
      },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
      if (generationRequestId) {
        await safe("attachJob", () =>
          attachGenerationRequestJob({
            id: generationRequestId!,
            profileId: profileId!,
            jobId: job.id,
          }),
        );
      }
    }

    // ---- Credit spend (BUSINESS LOGIC — must not be safe-wrapped) ----
    // Product Photo is priced by the selected model tier (+ resolution for
    // balanced/pro) provider cost (v2.3). The debit MUST happen before any
    // provider work below (createReplicateClient / uploadProductImageToReplicate
    // / runWithRetry / Nano Banana). If the wallet is short we fail the job (if
    // it exists) and return 402 — no processing asset, no provider call. A
    // non-balance infra failure rethrows into the outer catch as a 500 (and
    // `creditsSpent` stays false, so no refund is attempted).
    //
    // jobId-based idempotency prevents double-charges on retries WITHIN this
    // request. A full HTTP retry by the client produces a NEW jobId and a NEW
    // spend key — that double-charge risk is an accepted limitation of this
    // dummy phase (future fix: client/request-level idempotency key).
    // Batches are charged per image: N provider calls, N credit units, one ledger
    // row. Images that fail are refunded below rather than silently absorbed.
    const perImageCredits = devBlank ? 0 : await getProductPhotoCredits({ modelTier, resolution });
    const requiredCredits = perImageCredits * imageCount;
    if (!devBlank) {
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:product_photo:${jobId}`
          : `spend:product_photo:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Product Photo generation",
        metadata: {
          tool: "photo",
          jobType: "product_photo",
          poseId,
          styleId,
          modelTier,
          resolution,
          pricingKey,
          providerModel: photoModel.model,
          imageCount,
          perImageCredits,
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
            profileId: profileId!,
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
      // Non-balance infra failure: bubble up to the outer catch as a 500.
      throw e;
    }
    }

    // ---- Processing assets (created AFTER spend succeeds) ----
    // A batch gets one asset row per image so every generated file keeps its own
    // record; single generations behave exactly as before.
    const assetMetadata = {
      poseId,
      styleId,
      modelTier,
      resolution,
      pricingKey,
      providerResolution,
      ...(devBlank ? devBlankJobTag() : {}),
    };
    for (let index = 0; index < imageCount; index += 1) {
      const asset = await safe("createAsset", () => createProcessingAsset({
        profileId: profileId!,
        jobId: jobId ?? undefined,
        tool: "photo",
        assetType: "image",
        role: "product_photo",
        bucket: PRODUCT_PHOTO_BUCKET,
        provider: devBlank ? "dev_blank" : photoModel.provider,
        model: devBlank ? "dev_blank" : photoModel.model,
        metadata: imageCount > 1 ? { ...assetMetadata, batchIndex: index, imageCount } : assetMetadata,
      }));
      if (asset) photoAssetIds.push(asset.id);
    }
    photoAssetId = photoAssetIds[0] ?? null;

    const replicateHooks = makeReplicateCancelHooks({
      generationRequestId,
      profileId,
      jobId,
      kind: "product_photo",
    });

    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }

    // Product mode wraps the prompt in product-photography scaffolding; character
    // mode builds a multi-angle turnaround sheet; social mode adds feed-native
    // composition; image mode uses the prompt verbatim.
    const basePrompt =
      mode === "product"
        ? buildProductPhotoPrompt(poseId, styleId, userPrompt, { hasCharacterReference })
        : mode === "character"
          ? buildCharacterSheetPrompt({
              userPrompt,
              styleId: characterStyle,
              genderId: characterGender,
              ageId: characterAge,
            })
          : isSocialMode
            ? buildSocialPostPrompt({ userPrompt, aspectRatio })
            : userPrompt;

    // @-mention guidance: tell the model that the trailing reference images depict the
    // named subjects from the prompt, so it actually uses them as visual references.
    const prompt = mentionRefs.length
      ? `${basePrompt}${buildMentionGuidanceSuffix(mentionRefs)}`.trim()
      : basePrompt;

    // Non-product items aren't pose/style shots, so give the library a meaningful
    // title instead of the misleading "Standing · Minimalist Studio". Product
    // shots with both pose + style on "auto" would otherwise read "Auto · Auto",
    // so fall back to the prompt (or a generic label) in that case too.
    const savedTitle = isCharacterMode
      ? characterName || "Character"
      : mode === "image"
        ? userPrompt.slice(0, 60) || "Generated image"
        : isSocialMode
          ? userPrompt.slice(0, 60) || "Social media post"
          : poseId === "auto" && styleId === "auto"
            ? userPrompt.slice(0, 60) || "Product photo"
            : undefined;

    let blankImageBuffer: Buffer | null = null;
    let providerInput: Record<string, unknown> | null = null;
    let replicate: ReturnType<typeof createReplicateClient> | null = null;

    if (devBlank) {
      await beginStep("dev_blank", "Deliver blank placeholder image (admin test)");
      blankImageBuffer = await readBlankImageBytes();
      await endStep({ devBlank: true });
    } else {
      // Provider client is created only after the spend has succeeded.
      replicate = createReplicateClient();

      // Upload all reference images. Product mode leads with the required product
      // image, then any optional character image. Image mode uploads only an optional
      // reference (for reference-capable models). The first URL is the primary
      // reference; models that take a single reference image use it.
      const filesToUpload: File[] = requiresProductImage
        ? [file as File, ...extraReferenceFiles]
        : extraReferenceFiles;
      const referenceUrls: string[] = [];
      if (filesToUpload.length > 0) {
        await beginStep(
          "reference_upload",
          `Upload ${filesToUpload.length} reference image(s) to Replicate`
        );
        console.log(`[Product Photo] Uploading ${filesToUpload.length} reference image(s) to Replicate...`);
        for (const f of filesToUpload) {
          referenceUrls.push(await uploadProductImageToReplicate(replicate, f));
        }
        await endStep({ referenceUrls });
      }
      // Existing-image references (e.g. a saved character) need no upload.
      referenceUrls.push(...directReferenceUrls);

      // Aspect ratio comes from the chip (validated above). The builder sends only the
      // params each model family supports (reference param name + resolution vary by
      // model), passes multiple reference images where supported, and clamps the
      // aspect ratio to what the provider accepts.
      const imageInput = referenceUrls.length > 0 ? referenceUrls : undefined;
      providerInput = buildPhotoProviderInput({
        tier,
        prompt,
        aspectRatio,
        imageInput,
        providerResolution,
      });
    }

    // One provider call + download + Supabase save per batch image. Distinct
    // timestamps keep filenames (and the unique storage_path index) from
    // colliding when two calls land in the same millisecond.
    const batchTimestamp = Date.now();
    // Cancel stops being refundable the moment the provider hands back output.
    // A batch commits once, on the first image through — the other predictions
    // were already created and paid for by then. Shared promise so a commit
    // failure fails the whole batch instead of one arbitrary image.
    let commitPromise: Promise<void> | null = null;
    const commitProviderOnce = (): Promise<void> => {
      if (!generationRequestId || !profileId) return Promise.resolve();
      if (!commitPromise) {
        commitPromise = markProviderCommitted({
          generationRequestId,
          profileId,
          reason: "image_generation",
        });
      }
      return commitPromise;
    };

    const generateOne = async (index: number) => {
      let imageBuffer: ArrayBuffer;
      let mimeType = "image/png";

      if (devBlank && blankImageBuffer) {
        imageBuffer = blankImageBuffer.buffer.slice(
          blankImageBuffer.byteOffset,
          blankImageBuffer.byteOffset + blankImageBuffer.byteLength
        ) as ArrayBuffer;
      } else {
        const output = await runWithRetry(
          replicate!,
          photoModelRef,
          { input: providerInput! },
          10,
          replicateHooks,
        );

        const generatedImageUrl = extractMediaUrl(output);
        if (!generatedImageUrl.startsWith("http")) {
          throw new Error("Nano Banana did not return a valid image URL");
        }
        await commitProviderOnce();

        const imageResponse = await fetch(generatedImageUrl);
        if (!imageResponse.ok) {
          throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
        }
        const fetchedContentType = imageResponse.headers.get("content-type");
        mimeType = fetchedContentType && fetchedContentType.startsWith("image/")
          ? fetchedContentType
          : "image/png";

        imageBuffer = await imageResponse.arrayBuffer();
      }

      const filename = buildGeneratedFilename(poseId, styleId, batchTimestamp + index);

      const saved = await saveGeneratedProductPhoto({
        userId,
        photoMode: photoStorageModeFromGenerate(mode),
        filename,
        imageBuffer,
        poseId,
        styleId,
        contentType: "image/png",
        prompt: userPrompt || undefined,
        title: savedTitle,
        // Tag character creations so the library can group/badge them.
        creationKind: isCharacterMode
          ? CHARACTER_CREATION_KIND
          : isSocialMode
            ? SOCIAL_POST_CREATION_KIND
            : undefined,
        characterName: isCharacterMode && characterName ? characterName : undefined,
        modelTier,
        modelLabel: tier.modelLabel,
      });
      console.log("[Product Photo] Saved:", saved.storagePath, "user:", userId);
      return { saved, mimeType };
    };

    await beginStep(
      "image_generation",
      imageCount > 1
        ? `Generate ${imageCount} images + save to Supabase`
        : "Nano Banana product photo generation",
      { prompt, ...(imageCount > 1 ? { imageCount } : {}) }
    );
    console.log(
      devBlank
        ? `[Product Photo] Dev blank placeholder ×${imageCount}`
        : `[Product Photo] Running ${photoModelRef} ×${imageCount} (tier=${modelTier}, resolution=${providerResolution ?? "n/a"})...`
    );
    // Settled, not all-or-nothing: one bad image in a batch must not discard the
    // ones that worked. Failed images are refunded below. A user cancel aborts
    // every in-flight prediction, so all of them reject and the throw below
    // hands the cancellation to the outer catch.
    const outcomes = await Promise.allSettled(
      Array.from({ length: imageCount }, (_, index) => generateOne(index))
    );
    const successes = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
    const failureCount = outcomes.length - successes.length;
    if (successes.length === 0) {
      // Every image failed: rethrow so the outer catch refunds the whole spend.
      const firstRejection = outcomes.find((o) => o.status === "rejected");
      throw firstRejection && firstRejection.status === "rejected"
        ? firstRejection.reason
        : new Error("Image generation failed");
    }
    if (generationRequestId && profileId) {
      await assertNotCancelled(profileId, generationRequestId);
    }
    await endStep({
      generated: successes.length,
      failed: failureCount,
      storagePaths: successes.map((s) => s.saved.storagePath),
    });

    // Refund the images that never materialized, so the wallet only pays for
    // what the user actually got. `creditsAmount` follows so the display
    // snapshots below (and any later catch-block refund) stay honest.
    if (failureCount > 0) {
      const failedCredits = perImageCredits * failureCount;
      console.warn(`[Product Photo] ${failureCount}/${imageCount} batch image(s) failed — refunding ${failedCredits} credits`);
      await safe("refundFailedBatchImages", () => refundCredits({
        profileId: profileId!,
        amount: failedCredits,
        idempotencyKey: jobId
          ? `refund:product_photo:${jobId}:partial`
          : `refund:product_photo:profile:${profileId}:${batchTimestamp}:partial`,
        jobId: jobId ?? null,
        description: "Refund for failed batch images",
        metadata: { reason: "batch_image_failed", failureCount, imageCount, perImageCredits },
      }));
      creditsAmount = perImageCredits * successes.length;
    }

    // Platform: mark each asset ready (or failed), then finish the job.
    // `costCredits` is a display snapshot only — the ledger rows written by
    // spendCredits/refundCredits above are the billing source of truth.
    if (profileId) {
      for (let index = 0; index < photoAssetIds.length; index += 1) {
        const assetId = photoAssetIds[index];
        const outcome = outcomes[index];
        if (outcome && outcome.status === "fulfilled") {
          await safe("markAssetReady", () => markAssetReady(profileId!, assetId, {
            storagePath: outcome.value.saved.storagePath,
            mimeType: outcome.value.mimeType,
            costCredits: perImageCredits,
            metadata: assetMetadata,
          }));
        } else {
          const reason = outcome && outcome.status === "rejected" ? outcome.reason : null;
          await safe("markAssetFailed", () => markAssetFailed(profileId!, assetId, {
            message: reason instanceof Error ? reason.message : String(reason ?? "Image generation failed"),
          }));
        }
      }
      photoAssetsFinalized = true;
    }
    const primary = successes[0].saved;
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: {
          imageUrl: primary.publicUrl,
          storagePath: primary.storagePath,
          assetId: photoAssetId,
          imageCount: successes.length,
          storagePaths: successes.map((s) => s.saved.storagePath),
        },
        costCredits: creditsAmount,
      }));
    }

    // Usage event — analytics only, NEVER affects billing/response. Wrapped in
    // safe() so a failure here cannot fail the request.
    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: photoAssetId ?? null,
      tool: "photo",
      provider: photoModel.provider,
      model: photoModel.model,
      unitType: "image_count",
      units: successes.length,
      creditsCharged: creditsAmount,
      metadata: {
        jobType: "product_photo",
        poseId,
        styleId,
        modelTier,
        resolution,
        pricingKey,
        providerModel: photoModel.model,
        providerResolution,
        requestedImageCount: imageCount,
        failedImageCount: failureCount,
      },
    }));

    const successResponse = {
      // Primary image keeps the legacy single-image shape; `images` carries the
      // full batch for clients that render alternatives.
      imageUrl: primary.publicUrl,
      storagePath: primary.storagePath,
      historyItem: primary.historyItem,
      images: successes.map((s) => ({
        imageUrl: s.saved.publicUrl,
        storagePath: s.saved.storagePath,
        historyItem: s.saved.historyItem,
      })),
      requestedImageCount: imageCount,
      failedImageCount: failureCount,
      savedToCloud: true,
    };
    if (generationRequestId) {
      await safe("idemSuccess", () => finishGenerationRequestSuccess({
        id: generationRequestId!,
        profileId: profileId!,
        jobId: jobId ?? null,
        assetId: photoAssetId ?? null,
        responseJson: successResponse,
      }));
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const cancelled =
      profileId && generationRequestId
        ? await isRefundableUserCancellation(profileId, generationRequestId, error)
        : isCancellation(error);
    if (cancelled) console.log("[Product Photo] Cancelled by user.");
    else console.error("[Product Photo] Error:", error);
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
    // Skipped once the success path has already resolved each asset, so a late
    // failure can't flip a ready image back to failed.
    if (profileId && !photoAssetsFinalized) {
      for (const assetId of photoAssetIds) {
        await safe("failAsset", () => markAssetFailed(profileId!, assetId, errJson));
      }
    }
    if (jobId && profileId) {
      if (cancelled) {
        await safe("cancelJob", () => cancelJob(profileId!, jobId!, errJson));
      } else {
        await safe("failJob", () => failJob(profileId!, jobId!, errJson));
      }
    }

    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:product_photo:${jobId}`
          : `refund:product_photo:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: cancelled
          ? "Refund after user cancellation"
          : "Best-effort refund after generation failure",
        metadata: {
          reason: cancelled ? "generation_cancelled" : "generation_failed",
          originalError: errJson,
        },
      }));
    }

    if (generationRequestId) {
      await safe("idemFailure", () => finishGenerationRequestFailure({
        id: generationRequestId!,
        profileId: profileId!,
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

    const isNoImageProviderError =
      !pricingMissing &&
      /failed to generate image|did not return a valid image|prediction failed/i.test(
        message
      );
    const clientMessage = isNoImageProviderError
      ? "The AI couldn't generate an image from this request. Try a more descriptive prompt (and add a reference image if you have one)."
      : message;

    return NextResponse.json(
      pricingMissing
        ? { error: clientMessage, code: "PRICING_CONFIG_MISSING" }
        : { error: clientMessage },
      { status: 500 }
    );
  }
}
