import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import { getCreatorInfo, refreshAccessToken } from "@/lib/tiktok";

/**
 * GET /api/connections/tiktok/creator-info — read-only preview of the
 * connected TikTok account's privacy_level_options, used by the scheduler to
 * populate the required privacy-level dropdown (never defaulted silently —
 * see openspec/changes/tiktok-publish/design.md, Decision 4).
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: token, error } = await supabaseServer
    .from("platform_tokens")
    .select("access_token, refresh_token")
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (error || !token) {
    return NextResponse.json({ error: "TikTok not connected." }, { status: 404 });
  }

  try {
    const info = await getCreatorInfo(token.access_token);
    return NextResponse.json({ privacyLevelOptions: info.privacyLevelOptions });
  } catch {
    // Access token likely expired — refresh once, persist the rotated
    // refresh_token immediately (same ordering as the cron's publish path —
    // see Decision 3), then retry.
    if (!token.refresh_token) {
      return NextResponse.json({ error: "TikTok connection needs to be re-authorized." }, { status: 409 });
    }
    try {
      const refreshed = await refreshAccessToken(token.refresh_token);

      await supabaseServer.from("platform_tokens").upsert(
        {
          user_id: userId,
          platform: "tiktok",
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        },
        { onConflict: "user_id,platform" },
      );

      const info = await getCreatorInfo(refreshed.accessToken);
      return NextResponse.json({ privacyLevelOptions: info.privacyLevelOptions });
    } catch (err) {
      console.error("[tiktok-creator-info] failed after refresh:", err);
      return NextResponse.json({ error: "Failed to fetch TikTok creator info." }, { status: 502 });
    }
  }
}
