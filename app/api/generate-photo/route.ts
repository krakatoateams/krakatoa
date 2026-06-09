import { NextResponse } from "next/server";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  ModelPoseId,
  PhotoStyleId,
  PRODUCT_PHOTO_BUCKET,
  buildGeneratedFilename,
  buildProductPhotoPrompt,
} from "@/lib/product-photo";
import { saveGeneratedProductPhoto } from "@/lib/product-photo-storage";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
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
import { getProductPhotoCredits } from "@/lib/pricing-resolver";
import { getPhotoModels, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function isValidPose(id: string): id is ModelPoseId {
  return MODEL_POSES.some((p) => p.id === id);
}

function isValidStyle(id: string): id is PhotoStyleId {
  return PHOTO_STYLES.some((s) => s.id === id);
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
    const poseId = String(formData.get("poseId") || "").trim();
    const styleId = String(formData.get("styleId") || "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Product image file is required" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, or WebP images are supported" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Image must be 10MB or smaller" }, { status: 400 });
    }

    if (!isValidPose(poseId)) {
      return NextResponse.json({ error: "Invalid model pose" }, { status: 400 });
    }

    if (!isValidStyle(styleId)) {
      return NextResponse.json({ error: "Invalid photo style" }, { status: 400 });
    }

    // ---- Resolve runtime model + pricing (Admin Phase 2) ----
    // DB-backed config with fallback to the hardcoded defaults. The SAME resolved
    // model is reused for createJob, createProcessingAsset, the provider call, and
    // recordUsageEvent so observability never disagrees with what actually ran.
    const { image: photoModel } = await getPhotoModels();
    const photoModelRef = replicateRef(photoModel);

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
      input: { poseId, styleId },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — must not be safe-wrapped) ----
    // Product Photo is a flat 5 credits. The debit MUST happen before any
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
    const requiredCredits = await getProductPhotoCredits();
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:product_photo:${jobId}`
          : `spend:product_photo:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Product Photo generation",
        metadata: { tool: "photo", jobType: "product_photo", poseId, styleId },
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
      metadata: { poseId, styleId },
    }));
    if (asset) photoAssetId = asset.id;

    // Provider client is created only after the spend has succeeded.
    const replicate = createReplicateClient();

    await beginStep("reference_upload", "Upload product reference image to Replicate");
    console.log("[Product Photo] Uploading product image to Replicate...");
    const productImageUrl = await uploadProductImageToReplicate(replicate, file);
    await endStep({ productImageUrl });

    const prompt = buildProductPhotoPrompt(poseId, styleId);

    await beginStep("image_generation", "Nano Banana product photo generation");
    console.log(`[Product Photo] Running ${photoModelRef}...`);
    const output = await runWithRetry(replicate, photoModelRef, {
      input: {
        prompt,
        image_input: [productImageUrl],
        aspect_ratio: "4:5",
        output_format: "png",
      },
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
        metadata: { poseId, styleId },
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
      metadata: { jobType: "product_photo", poseId, styleId },
    }));

    return NextResponse.json({
      imageUrl: saved.publicUrl,
      historyItem: saved.historyItem,
      savedToCloud: true,
    });
  } catch (error: unknown) {
    console.error("[Product Photo] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    // Best-effort failure marking — must not throw or mask the original error.
    const errJson = { message };
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

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
