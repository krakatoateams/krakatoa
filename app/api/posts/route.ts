import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentProfile, requireCurrentProfile } from "@/lib/profiles-db";
import { getAssetForProfile } from "@/lib/assets-db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Shared helper: resolve user UUID from session email ───────────────────────
async function resolveUserId(email: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("users")
    .select("id")
    .eq("email", email)
    .single();
  return data?.id ?? null;
}

// ── GET /api/posts — return all posts for the current user ────────────────────
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const userId = await resolveUserId(session.user.email);
  if (!userId) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const { data, error } = await supabaseServer
    .from("posts")
    .select("*")
    .eq("user_id", userId)
    .order("scheduled_time", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ posts: data });
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth check ────────────────────────────────────────────────────────────
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // ── Look up the user's UUID by email ─────────────────────────────────────
    const userId = await resolveUserId(session.user.email);
    if (!userId) {
      return NextResponse.json(
        { error: "User account not found. Please sign out and sign in again." },
        { status: 404 },
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const { video_url, title, description, tags, scheduled_time, platform, asset_id, project_id } =
      body as {
        video_url?: string;
        title: string;
        description?: string;
        tags?: string;
        scheduled_time: string;
        platform: string;
        asset_id?: string;
        project_id?: string;
      };

    // Optional platform linkage. Validate UUID format up front so malformed ids
    // return 400 instead of a Postgres uuid-cast 500 later.
    if (asset_id !== undefined && asset_id !== null && !UUID_RE.test(String(asset_id))) {
      return NextResponse.json({ error: "asset_id must be a valid UUID." }, { status: 400 });
    }
    if (project_id !== undefined && project_id !== null && !UUID_RE.test(String(project_id))) {
      return NextResponse.json({ error: "project_id must be a valid UUID." }, { status: 400 });
    }
    const wantsPlatformLink = Boolean(asset_id) || Boolean(project_id);

    // ── Resolve platform profile ──────────────────────────────────────────────
    // profile_id is the platform ownership boundary. It is always server-derived;
    // never trust a client-provided profile_id.
    let profileId: string | null = null;
    if (wantsPlatformLink) {
      // Linkage requested -> a profile is required to verify ownership.
      try {
        const profile = await requireCurrentProfile();
        profileId = profile.id;
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
    let assetPublicUrl: string | null = null;
    if (asset_id && profileId) {
      const asset = await getAssetForProfile(profileId, asset_id);
      if (!asset || asset.deleted_at) {
        return NextResponse.json({ error: "Asset not found." }, { status: 404 });
      }
      if (asset.status !== "ready") {
        return NextResponse.json({ error: "Asset is not ready." }, { status: 409 });
      }
      verifiedAssetId = asset.id;
      assetPublicUrl = asset.public_url;
    }

    // ── Resolve media URL (manual wins; asset-derived only fills the gap) ──────
    let resolvedVideoUrl = video_url;
    if (!resolvedVideoUrl && verifiedAssetId) {
      if (!assetPublicUrl) {
        return NextResponse.json({ error: "Asset has no public URL." }, { status: 422 });
      }
      resolvedVideoUrl = assetPublicUrl;
    }

    if (!resolvedVideoUrl || !title || !scheduled_time || !platform) {
      return NextResponse.json(
        { error: "video_url, title, scheduled_time and platform are required." },
        { status: 400 },
      );
    }

    // ── Insert post ───────────────────────────────────────────────────────────
    const insertRow: Record<string, unknown> = {
      user_id: userId,
      video_url: resolvedVideoUrl,
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
