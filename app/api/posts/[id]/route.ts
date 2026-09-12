import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getCurrentProfile } from "@/lib/profiles-db";
import {
  POST_CLAIM_STALE_MS,
  isActivePublishClaim,
  postOwnerDenied,
  postPatchLostPublishRace,
} from "@/lib/post-ownership-pure";

// PATCH /api/posts/[id] — edit content/timing, re-arm, or soft-cancel a post.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const profile = await getCurrentProfile();
  if (!profile) {
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

  // Confirm the post belongs to the requesting user before updating.
  // Ownership is checked via profile_id (stable across user_id remapping).
  const { data: existing, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("id, profile_id, status, publish_started_at")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Post not found." }, { status: 404 });
  }

  const ownerDenied = postOwnerDenied(existing.profile_id, profile.id);
  if (ownerDenied) {
    return NextResponse.json({ error: ownerDenied.error }, { status: ownerDenied.status });
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
  if (isActivePublishClaim(existing.publish_started_at, Date.now())) {
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
  // otherwise the cron immediately gives up again. failed_at MUST also be
  // cleared here — it's what the 7-day storage safety-net cleanup queries
  // against, and this is the only place a post ever transitions out of
  // "failed" (cron never does) — a stale failed_at left over from the
  // original failure could otherwise cause that cleanup to delete storage
  // out from under an actively-retried post.
  if (status !== undefined) {
    // Only a retry (re-arm to "scheduled") or a cancel are legitimate
    // client-triggered transitions here — "published"/"failed"/"draft" are
    // cron/system-only and must never be settable through this user-facing
    // route. Reject outright rather than silently dropping (unlike `format`
    // above): a caller expecting their cancel/retry to apply must not get a
    // false "success" back.
    if (status !== "scheduled" && status !== "canceled") {
      return NextResponse.json(
        { error: 'status must be "scheduled" or "canceled".' },
        { status: 400 },
      );
    }
    updates.status = status;
    if (status === "scheduled") {
      updates.publish_attempts = 0;
      updates.last_error = null;
      updates.publish_started_at = null;
      updates.failed_at = null;
    }
  } else if (hasContentEdit && existing.status === "failed") {
    // Saving an edit to a failed post re-arms it for a clean retry.
    updates.status = "scheduled";
    updates.publish_attempts = 0;
    updates.last_error = null;
    updates.publish_started_at = null;
    updates.failed_at = null;
  }

  const staleCutoff = new Date(Date.now() - POST_CLAIM_STALE_MS).toISOString();
  const { data, error } = await supabaseServer
    .from("posts")
    .update(updates)
    .eq("id", id)
    .eq("profile_id", profile.id)
    .neq("status", "published")
    .or(`publish_started_at.is.null,publish_started_at.lt.${staleCutoff}`)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[posts/id] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lostRace = postPatchLostPublishRace(data);
  if (lostRace) {
    return NextResponse.json({ error: lostRace.error }, { status: lostRace.status });
  }

  return NextResponse.json({ success: true, post: data });
}
