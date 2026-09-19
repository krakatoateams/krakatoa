import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { supabaseServer } from "@/lib/supabase-server";
import type { Platform } from "@/lib/platform-tokens";

/**
 * GET /api/connections/status — returns which platform tokens exist for the
 * current user, plus the connected account's display identity for TikTok
 * (creator nickname) and Instagram (@username), so the Scheduler's
 * "Connected accounts" row can show WHO, not just whether.
 * `usernames[platform]` is null for a disconnected platform, for a connected
 * one whose best-effort fetch never succeeded (see each OAuth callback
 * route), or always for YouTube (see migration 100 — reading the channel
 * title would need a broader OAuth scope than this app requests).
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data, error } = await supabaseServer
    .from("platform_tokens")
    .select("platform, username")
    .eq("user_id", userId);

  if (error) {
    console.error("[connections-status] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load connection status." }, { status: 500 });
  }

  const rows = (data ?? []) as { platform: Platform; username: string | null }[];
  const connected = new Set(rows.map((r) => r.platform));
  const usernameByPlatform = new Map(rows.map((r) => [r.platform, r.username]));

  return NextResponse.json({
    youtube: connected.has("youtube"),
    tiktok: connected.has("tiktok"),
    instagram: connected.has("instagram"),
    usernames: {
      youtube: usernameByPlatform.get("youtube") ?? null,
      tiktok: usernameByPlatform.get("tiktok") ?? null,
      instagram: usernameByPlatform.get("instagram") ?? null,
    },
  });
}
