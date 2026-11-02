/**
 * Best-effort backfill of `posts.tiktok_share_url` for public TikTok posts
 * whose public post ID wasn't available yet at publish time (#486). See
 * lib/tiktok-share-url-backfill-pure.ts for why and for the cadence.
 *
 * Never changes a post's status and never re-publishes: it only fills a
 * still-null share URL. Every failure is logged and skipped.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { buildTikTokShareUrl, fetchPublishStatus, getCreatorInfo } from "@/lib/tiktok";
import { refreshTikTokTokensLocked } from "@/lib/tiktok-refresh-locked";
import { cronErrorLogSafe } from "@/lib/cron-publish-pure";
import {
  SHARE_URL_BACKFILL_BATCH,
  shareUrlBackfillWindowStart,
  shouldRunShareUrlBackfill,
  tiktokAccessTokenStillValid,
} from "@/lib/tiktok-share-url-backfill-pure";

/** Reuse the stored token while valid — refreshing rotates TikTok's refresh_token. */
async function tiktokAccessTokenFor(userId: string, nowMs: number): Promise<string | null> {
  const { data: token } = await supabaseServer
    .from("platform_tokens")
    .select("access_token, expires_at")
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (!token) return null;
  if (token.access_token && tiktokAccessTokenStillValid(token.expires_at, nowMs)) {
    return token.access_token;
  }
  const refreshed = await refreshTikTokTokensLocked(userId);
  return refreshed.ok ? refreshed.accessToken : null;
}

export async function backfillTikTokShareUrls(nowMs: number): Promise<number> {
  if (!shouldRunShareUrlBackfill(nowMs)) return 0;

  const { data: posts, error } = await supabaseServer
    .from("posts")
    .select("id, user_id, tiktok_publish_id")
    .eq("platform", "tiktok")
    .eq("status", "published")
    .not("tiktok_publish_id", "is", null)
    .is("tiktok_share_url", null)
    // SELF_ONLY posts never get a public post ID (null privacy = legacy
    // pre-review posts, which were all SELF_ONLY, and neq skips nulls).
    .neq("tiktok_privacy_level", "SELF_ONLY")
    .gte("scheduled_time", shareUrlBackfillWindowStart(nowMs))
    .order("scheduled_time", { ascending: false })
    .limit(SHARE_URL_BACKFILL_BATCH);

  if (error) {
    console.warn("[cron] TikTok share URL backfill query failed:", error.message);
    return 0;
  }

  const tokens = new Map<string, string | null>();
  const usernames = new Map<string, string>();
  let filled = 0;

  for (const post of posts ?? []) {
    try {
      if (!tokens.has(post.user_id)) {
        tokens.set(post.user_id, await tiktokAccessTokenFor(post.user_id, nowMs));
      }
      const accessToken = tokens.get(post.user_id);
      if (!accessToken) continue;

      const { publicPostId } = await fetchPublishStatus(accessToken, post.tiktok_publish_id);
      if (!publicPostId) continue;

      if (!usernames.has(post.user_id)) {
        usernames.set(post.user_id, (await getCreatorInfo(accessToken)).creatorUsername);
      }
      const username = usernames.get(post.user_id);
      if (!username) continue;

      const { data: updated } = await supabaseServer
        .from("posts")
        .update({ tiktok_share_url: buildTikTokShareUrl(username, publicPostId) })
        .eq("id", post.id)
        .eq("status", "published")
        .is("tiktok_share_url", null)
        .select("id")
        .maybeSingle();
      if (updated) {
        filled++;
        console.log(`[cron] ✓ Backfilled TikTok share URL for post ${post.id}`);
      }
    } catch (err) {
      console.warn(
        `[cron] Post ${post.id} — TikTok share URL backfill failed (non-blocking):`,
        cronErrorLogSafe(err),
      );
    }
  }

  return filled;
}
