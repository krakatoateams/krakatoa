import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  PHOTOS_FOLDER,
  STORAGE_BUCKET,
  photoProxySegmentsToStoragePath,
} from "@/lib/storage-buckets";

/**
 * GET /api/tiktok-photos/<userId>/…rest
 *
 * Exists solely so TikTok's Content Posting API (`source_info.source:
 * "PULL_FROM_URL"`) can fetch a photo from a URL under a domain we've verified.
 * Storage key: `{userId}/photos/…rest` (legacy `photos/{userId}/…rest` fallback).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const segments = params.path;

  if (
    !segments ||
    segments.length < 2 ||
    segments.some((s) => !s || s === ".." || s.includes("..") || s.includes("\0"))
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const storagePath =
    photoProxySegmentsToStoragePath(segments) ??
    `${PHOTOS_FOLDER}/${segments.join("/")}`;

  const { data, error } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const bytes = await data.arrayBuffer();
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
