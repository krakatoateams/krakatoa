import { NextResponse } from "next/server";
import Replicate from "replicate";
import { getSupabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  videosStoryboardPath,
} from "@/lib/storage-buckets";
import { extractMediaUrl, runReplicateWithRetry } from "@/lib/replicate-server";

export const maxDuration = 600;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
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
      .select("id, storyboard_url, seedance_prompt")
      .eq("id", storyboardId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { error: fetchError?.message || "Storyboard not found." },
        { status: 404 }
      );
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

    const { error: statusErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update({ status: "video_generating" })
      .eq("id", storyboardId);

    if (statusErr) {
      console.error("[Storyboard Video] status update:", statusErr);
      return NextResponse.json(
        { error: statusErr.message || "Failed to update status." },
        { status: 500 }
      );
    }

    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePrompt}`;
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

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
      return NextResponse.json(
        { error: "Failed to resolve video URL from Seedance output." },
        { status: 500 }
      );
    }

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
      return NextResponse.json(
        { error: `Failed to upload video: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl: videoUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    const { error: finalErr } = await supabase
      .from(STORYBOARDS_TABLE)
      .update({ video_url: videoUrl, status: "done" })
      .eq("id", storyboardId);

    if (finalErr) {
      console.error("[Storyboard Video] Final DB update:", finalErr);
      return NextResponse.json(
        { error: finalErr.message || "Video uploaded but failed to update record." },
        { status: 500 }
      );
    }

    console.log("[Storyboard Video] Done:", videoUrl);
    return NextResponse.json({ videoUrl });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[Storyboard Video] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
