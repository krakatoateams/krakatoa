import { NextResponse } from "next/server";
import {
  MODEL_POSES,
  PHOTO_STYLES,
  ModelPoseId,
  PhotoStyleId,
  ProductPhotoHistoryItem,
  buildGeneratedFilename,
  buildProductPhotoPrompt,
  historyItemFromPath,
} from "@/lib/product-photo";
import { uploadGeneratedImage } from "@/lib/product-photo-storage";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";

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
  try {
    const formData = await req.formData();
    const file = formData.get("image");
    const clientId = String(formData.get("clientId") || "").trim();
    const poseId = String(formData.get("poseId") || "").trim();
    const styleId = String(formData.get("styleId") || "").trim();

    if (!clientId || clientId.length > 64) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

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

    console.log("[Product Photo] Uploading product image to Replicate...");
    const productImageUrl = await uploadProductImageToReplicate(replicate, file);

    const prompt = buildProductPhotoPrompt(poseId, styleId);

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

    const imageResponse = await fetch(generatedImageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const filename = buildGeneratedFilename(poseId, styleId);

    let publicUrl = generatedImageUrl;
    let historyItem = null;

    try {
      const saved = await uploadGeneratedImage(clientId, filename, imageBuffer, "image/png");
      publicUrl = saved.publicUrl;
      historyItem = saved.historyItem ?? historyItemFromPath(saved.storagePath, saved.publicUrl);
      console.log("[Product Photo] Saved to Supabase:", saved.storagePath);
    } catch (storageErr: unknown) {
      const msg = storageErr instanceof Error ? storageErr.message : String(storageErr);
      console.warn("[Product Photo] Supabase save failed (returning Replicate URL):", msg);

      const pose = MODEL_POSES.find((p) => p.id === poseId)!;
      const style = PHOTO_STYLES.find((s) => s.id === styleId)!;
      const fallbackItem: ProductPhotoHistoryItem = {
        id: `temp_${Date.now()}`,
        imageUrl: generatedImageUrl,
        poseId,
        styleId,
        poseLabel: pose.label,
        styleLabel: style.label,
        createdAt: new Date().toISOString(),
        storagePath: "",
      };

      return NextResponse.json({
        imageUrl: generatedImageUrl,
        historyItem: fallbackItem,
        savedToCloud: false,
        warning:
          "Image generated but not saved to Supabase history. Create the public bucket in .env (SUPABASE_STORAGE_BUCKET) or check your service role key.",
      });
    }

    if (!historyItem) {
      throw new Error("Failed to build history metadata");
    }

    return NextResponse.json({
      imageUrl: publicUrl,
      historyItem,
      savedToCloud: true,
    });
  } catch (error: unknown) {
    console.error("[Product Photo] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
