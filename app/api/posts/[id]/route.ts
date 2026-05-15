import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

// PATCH /api/posts/[id] — update scheduled_time (reschedule)
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
  const { scheduled_time } = body as { scheduled_time: string };

  if (!scheduled_time) {
    return NextResponse.json({ error: "scheduled_time is required." }, { status: 400 });
  }

  // Confirm the post belongs to the requesting user before updating
  const { data: existing, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("id, user_id")
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

  const { data, error } = await supabaseServer
    .from("posts")
    .update({ scheduled_time })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[posts/id] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, post: data });
}
