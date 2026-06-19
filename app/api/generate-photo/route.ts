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
  buildProductPhotoPrompt,
  buildCharacterSheetPrompt,
  buildPhotoProviderInput,
  getProductPhotoTier,
  isValidPhotoAspectRatio,
  DEFAULT_PHOTO_ASPECT_RATIO,
  CHARACTER_CREATION_KIND,
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
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getUserCreationForUser } from "@/lib/creations-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
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
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Optional free-text creative direction (omni-form at /tools/photo-v2). Capped so a
// runaway client value can't bloat the provider prompt; empty when not supplied.
const PROMPT_MAX_CHARS = 1500;

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
    const modeRaw = String(formData.get("mode") || "product").trim();
    const mode: "product" | "image" | "character" =
      modeRaw === "image" || modeRaw === "character" ? modeRaw : "product";
    const requiresProductImage = mode === "product";
    const isCharacterMode = mode === "character";
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
        // Use a previously generated character. Owner-scoped lookup prevents using
        // someone else's (or an arbitrary) image as a reference.
        const creation = await getUserCreationForUser(userId, characterCreationId);
        if (!creation) {
          return NextResponse.json(
            { error: "Selected character could not be found." },
            { status: 400 }
          );
        }
        directReferenceUrls.push(creation.mediaUrl);
      }
    } else if (tier.supportsReference && referenceFile instanceof File) {
      const err = validateImageUpload(referenceFile);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      extraReferenceFiles.push(referenceFile);
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
      // Distinguish requests that add an optional character/reference image so a
      // retry with a different attachment set isn't treated as a replay.
      extraRefCount: extraReferenceFiles.length + directReferenceUrls.length,
      characterRef: characterCreationId,
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
      input: { poseId, styleId, modelTier, resolution, pricingKey, mode },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
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
    const requiredCredits = await getProductPhotoCredits({ modelTier, resolution });
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
      // Non-balance infra failure: bubble up to the outer catch as a 500.
      throw e;
    }

    // ---- Processing asset (created AFTER spend succeeds) ----
    const asset = await safe("createAsset", () => createProcessingAsset({
      profileId: profileId!,
      jobId: jobId ?? undefined,
      tool: "photo",
      assetType: "image",
      role: "product_photo",
      bucket: PRODUCT_PHOTO_BUCKET,
      provider: photoModel.provider,
      model: photoModel.model,
      metadata: { poseId, styleId, modelTier, resolution, pricingKey, providerResolution },
    }));
    if (asset) photoAssetId = asset.id;

    // Provider client is created only after the spend has succeeded.
    const replicate = createReplicateClient();

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

    // Product mode wraps the prompt in product-photography scaffolding; character
    // mode builds a multi-angle turnaround sheet; image mode uses the prompt verbatim.
    const prompt =
      mode === "product"
        ? buildProductPhotoPrompt(poseId, styleId, userPrompt)
        : mode === "character"
          ? buildCharacterSheetPrompt({
              userPrompt,
              styleId: characterStyle,
              genderId: characterGender,
              ageId: characterAge,
            })
          : userPrompt;

    // Aspect ratio comes from the chip (validated above). The builder sends only the
    // params each model family supports (reference param name + resolution vary by
    // model), passes multiple reference images where supported, and clamps the
    // aspect ratio to what the provider accepts.
    const imageInput = referenceUrls.length > 0 ? referenceUrls : undefined;
    const providerInput = buildPhotoProviderInput({
      tier,
      prompt,
      aspectRatio,
      imageInput,
      providerResolution,
    });

    await beginStep("image_generation", "Nano Banana product photo generation");
    console.log(`[Product Photo] Running ${photoModelRef} (tier=${modelTier}, resolution=${providerResolution ?? "n/a"})...`);
    const output = await runWithRetry(replicate, photoModelRef, {
      input: providerInput,
    });

    const generatedImageUrl = extractMediaUrl(output);
    if (!generatedImageUrl.startsWith("http")) {
      throw new Error("Nano Banana did not return a valid image URL");
    }
    await endStep({ generatedImageUrl });

    await beginStep("storage_upload", "Download generated image + save to Supabase");
    const imageResponse = await fetch(generatedImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    }
    const fetchedContentType = imageResponse.headers.get("content-type");
    const mimeType = fetchedContentType && fetchedContentType.startsWith("image/")
      ? fetchedContentType
      : "image/png";

    const imageBuffer = await imageResponse.arrayBuffer();
    const filename = buildGeneratedFilename(poseId, styleId);

    const saved = await saveGeneratedProductPhoto({
      userId,
      filename,
      imageBuffer,
      poseId,
      styleId,
      contentType: "image/png",
      prompt,
      // Non-product items aren't pose/style shots, so give the library a meaningful
      // title instead of the misleading "Standing · Minimalist Studio".
      title: isCharacterMode
        ? characterName || "Character"
        : mode === "image"
          ? userPrompt.slice(0, 60) || "Generated image"
          : undefined,
      // Tag character creations so the library can group/badge them.
      creationKind: isCharacterMode ? CHARACTER_CREATION_KIND : undefined,
      characterName: isCharacterMode && characterName ? characterName : undefined,
    });
    await endStep({ storagePath: saved.storagePath, publicUrl: saved.publicUrl });

    console.log("[Product Photo] Saved:", saved.storagePath, "user:", userId);

    // Platform: mark the asset ready, then finish the job. `costCredits` is a
    // display snapshot only — the ledger row created by spendCredits above is
    // the billing source of truth.
    if (photoAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, photoAssetId!, {
        storagePath: saved.storagePath,
        publicUrl: saved.publicUrl,
        mimeType,
        costCredits: creditsAmount,
        metadata: { poseId, styleId, modelTier, resolution, pricingKey, providerResolution },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { imageUrl: saved.publicUrl, storagePath: saved.storagePath, assetId: photoAssetId },
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
      units: 1,
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
      },
    }));

    const successResponse = {
      imageUrl: saved.publicUrl,
      historyItem: saved.historyItem,
      savedToCloud: true,
    };
    if (generationRequestId) {
      await safe("idemSuccess", () => finishGenerationRequestSuccess({
        id: generationRequestId!,
        jobId: jobId ?? null,
        assetId: photoAssetId ?? null,
        responseJson: successResponse,
      }));
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    console.error("[Product Photo] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    // Pricing fail-closed (v2.2): an unknown pricing key throws BEFORE the spend
    // and any provider call, so no credits were charged and no provider ran.
    const pricingMissing = error instanceof PricingConfigError;
    // Best-effort failure marking — must not throw or mask the original error.
    const errJson = pricingMissing
      ? { message, code: "PRICING_CONFIG_MISSING" }
      : { message };
    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (photoAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, photoAssetId!, errJson));
    }
    if (jobId && profileId) {
      await safe("failJob", () => failJob(profileId!, jobId!, errJson));
    }

    // Best-effort refund. Only fires when a spend actually succeeded (the
    // InsufficientCreditsError path never sets creditsSpent=true, and a 500
    // before the spend block also leaves it false). Wrapped in safe() so a
    // refund failure cannot mask the original generation error — the spend
    // ledger row stays in the DB and can be reconciled manually.
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:product_photo:${jobId}`
          : `refund:product_photo:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Best-effort refund after generation failure",
        metadata: { reason: "generation_failed", originalError: errJson },
      }));
    }

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
