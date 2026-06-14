import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, videosStoragePath } from "@/lib/storage-buckets";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB ceiling (matches client-side limit)

const ACCEPTED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime", // .mov
  "video/avi",
  "video/x-msvideo", // .avi (alternative MIME)
]);

// Mints a short-lived signed upload URL so the browser can upload the file
// bytes DIRECTLY to Supabase Storage (uploadToSignedUrl), bypassing the
// serverless request-body limit (~4.5 MB on Vercel) that the old multipart
// /api/upload hit. Only tiny JSON metadata transits this function.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const filename = String((body as Record<string, unknown>).filename ?? "").trim();
    const contentType = String((body as Record<string, unknown>).contentType ?? "").trim();
    const size = Number((body as Record<string, unknown>).size ?? 0);

    if (!filename) {
      return NextResponse.json({ error: "No filename provided." }, { status: 400 });
    }

    if (!ACCEPTED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: "Only MP4, MOV, and AVI files are accepted." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
    }

    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 50 MB limit." },
        { status: 413 },
      );
    }

    // Sanitise filename and make it unique, placed under the videos/ folder.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = videosStoragePath(`${Date.now()}-${safeName}`);

    const { data, error } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error("[upload/sign] createSignedUploadUrl error:", error?.message);
      return NextResponse.json(
        { error: error?.message ?? "Failed to create signed upload URL." },
        { status: 500 },
      );
    }

    const { data: urlData } = supabaseServer.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      bucket: STORAGE_BUCKET,
      path: data.path,
      token: data.token,
      publicUrl: urlData.publicUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to sign upload.";
    console.error("[upload/sign] Unexpected error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
