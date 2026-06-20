import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

// A claim newer than this means the cron is actively publishing the post right
// now, so edits/cancels are refused. Mirrors lib/post-status.ts's window.
const CLAIM_STALE_MS = 10 * 60 * 1000;

function isPublishing(publish_started_at?: string | null): boolean {
  if (!publish_started_at) return false;
  const claimedAt = new Date(publish_started_at).getTime();
  return Number.isFinite(claimedAt) && Date.now() - claimedAt < CLAIM_STALE_MS;
}

// PATCH /api/posts/[id] — edit content/timing, re-arm, or soft-cancel a post.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = params;
  const body = await req.json();
  const { scheduled_time, status, title, description, tags, format } = body as {
    scheduled_time?: string;
    status?: string;
    title?: string;
    description?: string;
    tags?: string;
    format?: string;
  };

  const hasContentEdit =
    title !== undefined ||
    description !== undefined ||
    tags !== undefined ||
    format !== undefined ||
    scheduled_time !== undefined;

  if (!hasContentEdit && status === undefined) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 },
    );
  }

  // Confirm the post belongs to the requesting user before updating
  const { data: existing, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("id, user_id, status, publish_started_at")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }

  const { data: userRow } = await supabaseServer
    .from("users")
    .select("id")
    .eq("email", session.user.email)
    .single();

  if (!userRow || existing.user_id !== userRow.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // ── Editability guards ──────────────────────────────────────────────────────
  // A published post is already live on YouTube; never editable/cancelable here.
  if (existing.status === "published") {
    return NextResponse.json(
      { error: "Published posts cannot be edited or canceled." },
      { status: 409 },
    );
  }
  // A post the cron has actively claimed is mid-upload; refuse to avoid a race.
  if (isPublishing(existing.publish_started_at)) {
    return NextResponse.json(
      { error: "This post is being published right now. Try again shortly." },
      { status: 409 },
    );
  }

  // ── Build the partial update ────────────────────────────────────────────────
  const updates: Record<string, unknown> = {};
  if (scheduled_time !== undefined) updates.scheduled_time = scheduled_time;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (tags !== undefined) updates.tags = tags;
  // Only persist a recognized format; ignore anything else (mirrors POST).
  if (format !== undefined && (format === "short" || format === "video")) {
    updates.format = format;
  }

  // Status transition. Re-arming to "scheduled" (Retry, or saving an edited
  // failed post) MUST reset the bounded-retry counter + clear the last error,
  // otherwise the cron immediately gives up again.
  if (status !== undefined) {
    updates.status = status;
    if (status === "scheduled") {
      updates.publish_attempts = 0;
      updates.last_error = null;
      updates.publish_started_at = null;
    }
  } else if (hasContentEdit && existing.status === "failed") {
    // Saving an edit to a failed post re-arms it for a clean retry.
    updates.status = "scheduled";
    updates.publish_attempts = 0;
    updates.last_error = null;
    updates.publish_started_at = null;
  }

  const { data, error } = await supabaseServer
    .from("posts")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[posts/id] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data });
}
