import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";

/** GET /api/connections/status — returns which platform tokens exist for the current user. */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data } = await supabaseServer
    .from("platform_tokens")
    .select("platform")
    .eq("user_id", userId);

  const connected = new Set((data ?? []).map((r: { platform: string }) => r.platform));

  return NextResponse.json({ youtube: connected.has("youtube") });
}
