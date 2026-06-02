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
import { getSessionUserId } from "@/lib/resolve-user";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";

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
    // Normal path: identity from the NextAuth session via the profile.
    //   profile.id      -> platform tables (jobs / job_steps / assets)
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
      // TEMPORARY SAFETY FALLBACK ONLY — must NOT become the normal path. On a
      // non-auth infrastructure error, keep legacy generation working but SKIP all
      // platform observability (profileId stays null -> guarded no-ops).
      console.warn("[photo obs] profile resolution failed for non-auth reasons — continuing legacy-only, platform observability skipped:", e);
      userId = await getSessionUserId();
      if (!userId) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
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

    const replicate = createReplicateClient();

    // ---- Platform job + processing image asset (best-effort observability) ----
    // Created after all input validation so validation early-returns never leave
    // a dangling job. The whole route below is throw-based, so failures are
    // finalized in the catch block.
    if (profileId) {
      const job = await safe("createJob", () => createJob({
        profileId: profileId!,
        tool: "photo",
        jobType: "product_photo",
        provider: "replicate",
        model: "google/nano-banana",
        input: { poseId, styleId },
      }));
      if (job) {
        jobId = job.id;
        await safe("startJob", () => startJob(profileId!, jobId!));
        const asset = await safe("createAsset", () => createProcessingAsset({
          profileId: profileId!,
          jobId: jobId!,
          tool: "photo",
          assetType: "image",
          role: "product_photo",
          bucket: PRODUCT_PHOTO_BUCKET,
          provider: "replicate",
          model: "google/nano-banana",
          metadata: { poseId, styleId },
        }));
        if (asset) photoAssetId = asset.id;
      }
    }

    await beginStep("reference_upload", "Upload product reference image to Replicate");
    console.log("[Product Photo] Uploading product image to Replicate...");
    const productImageUrl = await uploadProductImageToReplicate(replicate, file);
    await endStep({ productImageUrl });

    const prompt = buildProductPhotoPrompt(poseId, styleId);

    await beginStep("image_generation", "Nano Banana product photo generation");
    console.log("[Product Photo] Running google/nano-banana...");
    const output = await runWithRetry(replicate, "google/nano-banana", {
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

    // Platform: mark the asset ready, then finish the job.
    if (photoAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, photoAssetId!, {
        storagePath: saved.storagePath,
        publicUrl: saved.publicUrl,
        mimeType,
        metadata: { poseId, styleId },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { imageUrl: saved.publicUrl, storagePath: saved.storagePath, assetId: photoAssetId },
      }));
    }

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
