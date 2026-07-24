import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { STORAGE_BUCKET, PHOTOS_FOLDER } from "@/lib/storage-buckets";

/**
 * GET /api/tiktok-photos/<path under photos/>
 *
 * Exists solely so TikTok's Content Posting API (`source_info.source:
 * "PULL_FROM_URL"`, the only source photo posts support — see
 * openspec/changes/tiktok-photo-post/design.md) can fetch a photo from a URL
 * under a domain we've verified ownership of. Our generated photos are
 * actually stored on Supabase's own domain (`*.supabase.co`), which we don't
 * own and can't verify — this route re-serves those bytes from this app's
 * (verified) domain instead.
 *
 * Security: this is a public, unauthenticated, attacker-facing endpoint by
 * necessity (TikTok's servers must be able to fetch it with no auth). It
 * must never become an open fetch proxy — every requested path is forced
 * under the storage bucket's `photos/` prefix before touching Storage, and
 * objects are fetched by exact key via the Storage API (not by re-parsing a
 * client-supplied URL), so there's no way to reach any other prefix
 * (`videos/`, etc.) or an arbitrary external URL through this route.
 *
 * No redirect: TikTok's docs explicitly require the pulled URL not redirect,
 * so the object bytes are streamed directly rather than 30x-ing to the real
 * Supabase URL.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const segments = params.path;

  // Reject empty, path-traversal, or otherwise suspicious segments outright —
  // before ever constructing a storage key.
  if (
    !segments ||
    segments.length === 0 ||
    segments.some((s) => !s || s === ".." || s.includes("..") || s.includes("\0"))
  ) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Always force the lookup under photos/ — the client-facing URL never
  // includes that segment itself (it's implicit), so there is no client-
  // controlled way to point this at videos/ or any other bucket prefix.
  const storagePath = `${PHOTOS_FOLDER}/${segments.join("/")}`;
  if (!storagePath.startsWith(`${PHOTOS_FOLDER}/`)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

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
