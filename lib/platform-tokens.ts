import { supabaseServer } from "@/lib/supabase-server";

export type Platform = "youtube" | "tiktok" | "instagram";

/**
 * Best-effort refresh of platform_tokens.username (Scheduler's "Connected
 * accounts" row). Never throws — a failure here must never block or fail
 * the caller's actual flow (OAuth connect, creator-info fetch, etc).
 */
export async function updatePlatformUsername(
  userId: string,
  platform: Platform,
  username: string,
): Promise<void> {
  if (!username) return;
  try {
    await supabaseServer
      .from("platform_tokens")
      .update({ username })
      .eq("user_id", userId)
      .eq("platform", platform);
  } catch (err) {
    console.warn(`[platform-tokens] username update failed for ${platform}:`, err);
  }
}
