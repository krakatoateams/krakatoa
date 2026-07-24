import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentProfile, requireCurrentProfile } from "@/lib/profiles-db";
import { getAssetForProfile } from "@/lib/assets-db";
import { isVideoUrlConfirmedMissing, videoObjectExists } from "@/lib/video-storage";
import {
  assertPathOwnedByUser,
  resolveSignedMediaUrl,
  resolveStoragePath,
} from "@/lib/storage-signed-url";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── GET /api/posts — return all posts for the current user ────────────────────
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data, error } = await supabaseServer
    .from("posts")
    .select("*")
    .eq("profile_id", profile.id)
    .order("scheduled_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const posts = await Promise.all(
    (data ?? []).map(async (row) => {
      const post = row as Record<string, unknown>;
      const raw = post.video_url as string | null;
      const path = resolveStoragePath(null, raw);
      if (!path) return post;
      try {
        const signed = await resolveSignedMediaUrl({
          userId: profile.user_id,
          storagePath: path,
        });
        return signed ? { ...post, video_url: signed } : post;
      } catch (err: unknown) {
        console.warn(
          "[posts] sign video_url failed:",
          path,
          err instanceof Error ? err.message : err,
        );
        return post;
      }
    }),
  );

  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  try {
    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const {
      video_url,
      storage_path,
      title,
      description,
      tags,
      scheduled_time,
      platform,
      asset_id,
      project_id,
      format,
      tiktok_privacy_level,
      tiktok_brand_organic_toggle,
      tiktok_brand_content_toggle,
    } = body as {
      video_url?: string;
      storage_path?: string;
      title: string;
      description?: string;
      tags?: string;
      scheduled_time: string;
      platform: string;
      asset_id?: string;
      project_id?: string;
      format?: string;
      tiktok_privacy_level?: string;
      tiktok_brand_organic_toggle?: boolean;
      tiktok_brand_content_toggle?: boolean;
    };

    // Publish format is optional; only persist a recognized value, otherwise
    // leave it null (unknown). Never fail the request over a bad format.
    const normalizedFormat = format === "short" || format === "video" ? format : null;

    // TikTok-only fields. The privacy level must be one the user's own account
    // actually offers (never defaulted — see design.md Decision 4); unlike
    // `format`, an invalid privacy level fails the request rather than being
    // silently dropped, since publishing without it is not a safe fallback.
    const TIKTOK_PRIVACY_LEVELS = new Set([
      "PUBLIC_TO_EVERYONE",
      "MUTUAL_FOLLOW_FRIENDS",
      "FOLLOWER_OF_CREATOR",
      "SELF_ONLY",
    ]);
    if (platform === "tiktok") {
      if (!tiktok_privacy_level || !TIKTOK_PRIVACY_LEVELS.has(tiktok_privacy_level)) {
        return NextResponse.json(
          { error: "tiktok_privacy_level is required and must be a valid TikTok privacy level." },
          { status: 400 },
        );
      }
      // Branded content must be publicly viewable — TikTok requires this for
      // its Commercial Content Library. Reject the combination outright rather
      // than silently dropping the disclosure flag (see design.md Decision 4a).
      if (tiktok_brand_content_toggle && tiktok_privacy_level === "SELF_ONLY") {
        return NextResponse.json(
          { error: "Branded content cannot be posted with SELF_ONLY privacy — TikTok requires it to be publicly viewable." },
          { status: 400 },
        );
      }
    }

    // Optional platform linkage. Validate UUID format up front so malformed ids
    // return 400 instead of a Postgres uuid-cast 500 later.
    if (asset_id !== undefined && asset_id !== null && !UUID_RE.test(String(asset_id))) {
      return NextResponse.json({ error: "asset_id must be a valid UUID." }, { status: 400 });
    }
    if (project_id !== undefined && project_id !== null && !UUID_RE.test(String(project_id))) {
      return NextResponse.json({ error: "project_id must be a valid UUID." }, { status: 400 });
    }
    const wantsPlatformLink = Boolean(asset_id) || Boolean(project_id);

    // ── Resolve profile (auth + ownership boundary) ───────────────────────────
    // profile_id is the platform ownership boundary. It is always server-derived;
    // never trust a client-provided profile_id.
    let profileId: string | null = null;
    let userId: string | null = null;
    if (wantsPlatformLink) {
      // Linkage requested -> a profile is required to verify ownership.
      try {
        const profile = await requireCurrentProfile();
        profileId = profile.id;
        userId = profile.user_id;
      } catch (e) {
        if (e instanceof Error && /not authenticated/i.test(e.message)) {
          return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
        }
        throw e; // infra error -> existing 500 catch
      }
    } else {
      // No linkage -> populate profile_id best-effort; never fail the request.
      try {
        const profile = await getCurrentProfile();
        profileId = profile?.id ?? null;
        userId = profile?.user_id ?? null;
      } catch {
        profileId = null;
      }
    }

    // ── Verify optional project ownership ─────────────────────────────────────
    let verifiedProjectId: string | null = null;
    if (project_id && profileId) {
      const { data: project } = await supabaseServer
        .from("projects")
        .select("id")
        .eq("id", project_id)
        .eq("profile_id", profileId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!project) {
        return NextResponse.json({ error: "Project not found." }, { status: 404 });
      }
      verifiedProjectId = project.id as string;
    }

    // ── Verify optional asset ownership + derive media URL ────────────────────
    let verifiedAssetId: string | null = null;
    let assetStoragePath: string | null = null;
    if (asset_id && profileId) {
      const asset = await getAssetForProfile(profileId, asset_id);
      if (!asset || asset.deleted_at) {
        return NextResponse.json({ error: "Asset not found." }, { status: 404 });
      }
      if (asset.status !== "ready") {
        return NextResponse.json({ error: "Asset is not ready." }, { status: 409 });
      }
      verifiedAssetId = asset.id;
      assetStoragePath = asset.storage_path;
    }

    // ── Resolve storage path (preferred) or legacy http URL ───────────────────
    const resolvedPath = resolveStoragePath(
      storage_path?.trim() || assetStoragePath,
      video_url,
    );
    const legacyHttpUrl =
      !resolvedPath && typeof video_url === "string" && video_url.trim().startsWith("http")
        ? video_url.trim()
        : null;

    if ((!resolvedPath && !legacyHttpUrl) || !title || !scheduled_time || !platform) {
      return NextResponse.json(
        { error: "storage_path (or video_url), title, scheduled_time and platform are required." },
        { status: 400 },
      );
    }

    // ── Reject scheduling a video that's already gone from storage ────────────
    if (resolvedPath) {
      if (!userId) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      try {
        await assertPathOwnedByUser(resolvedPath, userId);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Forbidden.";
        const status = /invalid storage/i.test(message) ? 400 : 403;
        return NextResponse.json({ error: message }, { status });
      }
      const exists = await videoObjectExists(resolvedPath);
      if (exists === false) {
        return NextResponse.json(
          { error: "Video file no longer exists in storage. Please re-upload or regenerate the video." },
          { status: 422 },
        );
      }
    } else if (legacyHttpUrl && (await isVideoUrlConfirmedMissing(legacyHttpUrl))) {
      return NextResponse.json(
        { error: "Video file no longer exists in storage. Please re-upload or regenerate the video." },
        { status: 422 },
      );
    }

    // Persist storage path in video_url when ours; legacy http URLs unchanged.
    const persistedVideoRef = resolvedPath ?? legacyHttpUrl!;

    // ── Insert post ───────────────────────────────────────────────────────────
    const insertRow: Record<string, unknown> = {
      user_id: userId,
      video_url: persistedVideoRef,
      title,
      description: description ?? "",
      tags: tags ?? "",
      scheduled_time,
      platform,
      status: "scheduled",
    };
    if (profileId) insertRow.profile_id = profileId;
    if (verifiedProjectId) insertRow.project_id = verifiedProjectId;
    if (verifiedAssetId) insertRow.asset_id = verifiedAssetId;
    if (normalizedFormat) insertRow.format = normalizedFormat;
    if (platform === "tiktok") {
      insertRow.tiktok_privacy_level = tiktok_privacy_level;
      insertRow.tiktok_brand_organic_toggle = Boolean(tiktok_brand_organic_toggle);
      insertRow.tiktok_brand_content_toggle = Boolean(tiktok_brand_content_toggle);
    }

    const { data, error } = await supabaseServer
      .from("posts")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      console.error("[posts] insert failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, post: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("[posts] unexpected:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
