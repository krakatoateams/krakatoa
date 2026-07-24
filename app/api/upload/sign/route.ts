import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  STORAGE_BUCKET,
  photosSchedulerUploadPath,
  videosSchedulerUploadPath,
} from "@/lib/storage-buckets";
import { requireCurrentProfile } from "@/lib/profiles-db";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB ceiling (matches client-side limit)
// Same ceiling/allow-list as app/api/generate-photo/route.ts, for consistency
// across every photo-upload entry point in the app.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ACCEPTED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime", // .mov
  "video/avi",
  "video/x-msvideo", // .avi (alternative MIME)
]);
const ACCEPTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Mints a short-lived signed upload URL so the browser can upload the file
// bytes DIRECTLY to Supabase Storage (uploadToSignedUrl), bypassing the
// serverless request-body limit (~4.5 MB on Vercel) that the old multipart
// /api/upload hit. Only tiny JSON metadata transits this function.
//
// mediaType (optional, defaults to "video" for backward compatibility with
// every existing caller that predates photo support — see
// openspec/changes/tiktok-photo-post/design.md Decision 8): "image" targets
// photos/{userId}/uploads/scheduler/ instead of videos/, with photo-appropriate
// validation. A raw scheduler photo upload is intentionally ephemeral (no
// user_creations row) — same precedent as a raw scheduler video upload,
// which also never creates one.
export async function POST(req: NextRequest) {
  try {
    const profile = await requireCurrentProfile();
    const userId = profile.user_id;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const filename = String((body as Record<string, unknown>).filename ?? "").trim();
    const contentType = String((body as Record<string, unknown>).contentType ?? "").trim();
    const size = Number((body as Record<string, unknown>).size ?? 0);
    const mediaType = (body as Record<string, unknown>).mediaType === "image" ? "image" : "video";
    const isImage = mediaType === "image";

    if (!filename) {
      return NextResponse.json({ error: "No filename provided." }, { status: 400 });
    }

    const acceptedTypes = isImage ? ACCEPTED_IMAGE_MIME_TYPES : ACCEPTED_VIDEO_MIME_TYPES;
    if (!acceptedTypes.has(contentType)) {
      return NextResponse.json(
        {
          error: isImage
            ? "Only JPEG, PNG, and WebP files are accepted."
            : "Only MP4, MOV, and AVI files are accepted.",
        },
        { status: 400 },
      );
    }

    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Invalid file size." }, { status: 400 });
    }

    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds the ${isImage ? "10" : "50"} MB limit.` },
        { status: 413 },
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = isImage
      ? photosSchedulerUploadPath(userId, `${Date.now()}-${safeName}`)
      : videosSchedulerUploadPath(userId, `${Date.now()}-${safeName}`);

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

    // Read URL is minted after upload via GET /api/storage/sign (object must exist).
    return NextResponse.json({
      bucket: STORAGE_BUCKET,
      path: data.path,
      token: data.token,
      storagePath,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to sign upload.";
    const status = /not authenticated/i.test(message) ? 401 : 500;
    console.error("[upload/sign] Unexpected error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
