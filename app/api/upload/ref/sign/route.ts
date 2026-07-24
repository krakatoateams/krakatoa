import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, videosUserTempRefPath } from "@/lib/storage-buckets";
import { requireCurrentProfile } from "@/lib/profiles-db";

/**
 * Mints a short-lived signed upload URL for a GENERATION REFERENCE file
 * (first/last frame image, reference image/video/audio). The browser then
 * uploads the bytes DIRECTLY to Supabase Storage via uploadToSignedUrl,
 * bypassing the serverless request-body limit (~4.5 MB on Vercel).
 *
 * Differences from /api/upload/sign:
 *   - Login required (requireCurrentProfile) — only authenticated users.
 *   - Accepts image/*, video/*, audio/* (the Seedance reference slots).
 *   - Always lands under `videos/temp/refs/` — transient by design, so it is
 *     covered by the storage sweep AND explicitly cleaned up by the generation
 *     route after success/failure/insufficient-credits.
 */

// 100 MB ceiling — accommodates Motion Control reference videos (Kling allows up
// to 100 MB). Smaller per-provider limits are enforced by the model schemas.
const MAX_BYTES = 100 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set([
  // images
  "image/jpeg",
  "image/png",
  "image/webp",
  // videos
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // audios
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
]);

export async function POST(req: NextRequest) {
  try {
    // Login gate. A missing/invalid session surfaces as 401; anything else 500.
    let userId: string;
    try {
      const profile = await requireCurrentProfile();
      userId = profile.user_id;
    } catch (authErr: unknown) {
      const message =
        authErr instanceof Error ? authErr.message : "Authentication required.";
      const isAuth = /sign in|not authenticated|unauthorized|session/i.test(message);
      return NextResponse.json(
        { error: isAuth ? "Please sign in to upload references." : message },
        { status: isAuth ? 401 : 500 },
      );
    }

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
        { error: "Only image, video, and audio reference files are accepted." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
    }

    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 100 MB limit." },
        { status: 413 },
      );
    }

    // Sanitise + make unique, placed under videos/{userId}/temp/refs/.
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = videosUserTempRefPath(
      userId,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`,
    );

    const { data, error } = await supabaseServer.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      console.error("[upload/ref/sign] createSignedUploadUrl error:", error?.message);
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
    console.error("[upload/ref/sign] Unexpected error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
