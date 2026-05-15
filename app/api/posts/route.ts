import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

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
    const { video_url, title, description, tags, scheduled_time, platform } =
      body as {
        video_url: string;
        title: string;
        description?: string;
        tags?: string;
        scheduled_time: string;
        platform: string;
      };

    if (!video_url || !title || !scheduled_time || !platform) {
      return NextResponse.json(
        { error: "video_url, title, scheduled_time and platform are required." },
        { status: 400 },
      );
    }

    // ── Insert post ───────────────────────────────────────────────────────────
    const { data, error } = await supabaseServer
      .from("posts")
      .insert({
        user_id: userId,
        video_url,
        title,
        description: description ?? "",
        tags: tags ?? "",
        scheduled_time,
        platform,
        status: "scheduled",
      })
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
