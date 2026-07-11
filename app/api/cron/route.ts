import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadToYouTube } from "@/lib/youtube";
import { refreshAccessToken, publishToTikTok } from "@/lib/tiktok";
import { removeStorageObjects } from "@/lib/creations-db";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";

// Stay within the hosting plan's serverless cap so one run can't time out mid-batch.
export const maxDuration = 60;

// Process exactly one due post per run. YouTube's own quota caps practical
// throughput at ~6 uploads/day, so we never need batching — and a single
// download+upload finishes comfortably under maxDuration, shrinking the timeout
// window that is the only remaining source of duplicate uploads. With a ~1-minute
// trigger cadence, any realistic backlog still drains quickly.
const MAX_POSTS_PER_RUN = 1;

// A post claimed (publish_started_at set) but not resolved within this window is
// treated as abandoned — e.g. the function timed out mid-upload — and may be
// re-claimed by a later run.
const CLAIM_STALE_MS = 10 * 60 * 1000;

// Transient failures are retried up to this many attempts before giving up.
const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Classify an upload failure. Permanent failures will not self-heal on retry and
 * may waste scarce YouTube quota, so they are marked failed immediately.
 *  - auth/token problems: user must re-authorise (401, missing/invalid token)
 *  - quota: daily cap hit (403 quotaExceeded) — retrying just burns more quota
 * Everything else (network blips, 5xx, fetch errors) is treated as transient.
 */
function isPermanentFailure(err: unknown, message: string): boolean {
  const m = message.toLowerCase();
  if (/re-?authori|refresh token|invalid_grant|sign in again|token for user|access token from google/.test(m)) {
    return true;
  }
  if (/quota|dailylimitexceeded|quotaexceeded/.test(m)) {
    return true;
  }
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return true;
  return false;
}

/**
 * Same intent as isPermanentFailure, for TikTok's error shapes (which don't
 * overlap with Google's): auth/scope/reconnect problems and the SELF_ONLY +
 * branded-content conflict are permanent (retrying wastes an attempt on
 * something that cannot self-heal); everything else is treated as transient.
 */
function isTikTokPermanentFailure(_err: unknown, message: string): boolean {
  const m = message.toLowerCase();
  if (/re-?authori|refresh token|reconnect|token for user|token request failed/.test(m)) {
    return true;
  }
  if (/branded content cannot be posted|self_only/.test(m)) {
    return true;
  }
  return false;
}

/**
 * Extract the storage-relative path from a Supabase public URL so we can
 * call storage.remove(). Returns null for URLs that don't match this bucket.
 * e.g. "https://…/object/public/krakatoa/videos/x.mp4" → "videos/x.mp4"
 */
function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length) || null;
}

/**
 * Best-effort: delete the video file from storage (only when the post has no
 * asset_id — asset-owned files must not be removed here) and null out
 * video_url on the post row. Logs but never throws — a storage failure must
 * not unwind a successful YouTube publish.
 */
async function cleanupPostVideo(
  postId: string,
  videoUrl: string | null | undefined,
  assetId: string | null | undefined,
): Promise<void> {
  if (assetId) {
    // The file belongs to an asset row — deleting it here would break the
    // asset's public_url and the Reels Creator history gallery.
    console.log(`[cron] post ${postId} is asset-linked (asset_id=${assetId}) — skipping storage deletion`);
  } else {
    const path = storagePathFromPublicUrl(videoUrl);
    if (path) {
      await removeStorageObjects([path]);
      console.log(`[cron] storage object removed: ${path}`);
    } else if (videoUrl) {
      console.warn(`[cron] could not extract storage path from video_url: ${videoUrl}`);
    }
  }
  const { error } = await supabaseServer.from("posts").update({ video_url: null }).eq("id", postId);
  if (error) console.warn(`[cron] failed to null video_url for post ${postId}:`, error.message);
}

/**
 * GET /api/cron
 *
 * Finds posts whose scheduled_time has passed and status is still "scheduled",
 * claims a bounded batch, uploads each to YouTube, and marks it published/failed.
 *
 * Safety:
 *  - Bounded batch + maxDuration keep each run inside platform limits.
 *  - A claim-lock (publish_started_at) prevents overlapping/retried runs from
 *    uploading the same post twice. Stale claims become re-claimable.
 *  - Posts that already carry a youtube_video_id are never re-uploaded.
 *  - Transient failures retry up to MAX_PUBLISH_ATTEMPTS; permanent failures
 *    (auth/quota) fail immediately. Failures store a reason in last_error.
 *
 * Protection: when CRON_SECRET is set in env, requests must include
 *   Authorization: Bearer <CRON_SECRET>
 * When CRON_SECRET is absent (local dev), all requests are allowed.
 *
 * Triggered by cron-job.org (~1 min, primary) and GitHub Actions (backup); see
 * .github/workflows/publish-cron.yml. Concurrent triggers are safe (claim-lock).
 */
export async function GET(req: NextRequest) {
  // ── Auth guard ─────────────────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  // ── Fetch a bounded batch of due posts ──────────────────────────────────────
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const staleCutoff = new Date(nowMs - CLAIM_STALE_MS).toISOString();

  const { data: duePosts, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_time", now)
    .order("scheduled_time", { ascending: true })
    .limit(MAX_POSTS_PER_RUN);

  if (fetchErr) {
    console.error("[cron] failed to fetch posts:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = duePosts ?? [];
  console.log(`[cron] ${posts.length} candidate post(s) due at ${now} (cap ${MAX_POSTS_PER_RUN})`);

  if (posts.length === 0) {
    return NextResponse.json({ processed: 0, published: 0, failed: 0, skipped: 0 });
  }

  let published = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const post of posts) {
    console.log(`[cron] Processing post:`, {
      id: post.id,
      title: post.title,
      platform: post.platform,
      user_id: post.user_id,
      scheduled_time: post.scheduled_time,
      video_url: post.video_url,
    });

    // ── Claim-lock: only proceed if we win the conditional update. This blocks a
    //    concurrent/overlapping run from uploading the same post. A claim older
    //    than the stale window is treated as abandoned and re-claimable. ────────
    const { data: claimed, error: claimErr } = await supabaseServer
      .from("posts")
      .update({ publish_started_at: now })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .or(`publish_started_at.is.null,publish_started_at.lt.${staleCutoff}`)
      .select("id, youtube_video_id, tiktok_publish_id")
      .maybeSingle();

    if (claimErr) {
      console.error(`[cron] Claim error for post ${post.id}:`, claimErr.message);
      skipped++;
      continue;
    }

    if (!claimed) {
      console.log(`[cron] Post ${post.id} already claimed elsewhere — skipping`);
      skipped++;
      continue;
    }

    // ── Idempotency: a post that already published must never publish again. ────
    const alreadyPublishedId =
      post.platform === "tiktok" ? claimed.tiktok_publish_id : claimed.youtube_video_id;
    if (alreadyPublishedId) {
      console.log(`[cron] Post ${post.id} already has a ${post.platform} publish ID — marking published, no re-upload`);
      await supabaseServer
        .from("posts")
        .update({ status: "published", last_error: null, publish_started_at: null, publish_attempts: 0 })
        .eq("id", post.id);
      await cleanupPostVideo(post.id, post.video_url, post.asset_id);
      published++;
      continue;
    }

    try {
      // ── Get user's platform token ──────────────────────────────────────────
      const { data: token, error: tokenErr } = await supabaseServer
        .from("platform_tokens")
        .select("access_token, refresh_token")
        .eq("user_id", post.user_id)
        .eq("platform", post.platform)
        .single();

      if (tokenErr) {
        console.error(`[cron] Token lookup error for post ${post.id}:`, tokenErr.message);
        throw new Error(`No ${post.platform} token for user ${post.user_id}: ${tokenErr.message}`);
      }

      if (!token) {
        console.error(`[cron] No token row found for user ${post.user_id} / platform ${post.platform}`);
        throw new Error(
          `No ${post.platform} token for user ${post.user_id}. ` +
          "The user must sign in again to re-authorise.",
        );
      }

      console.log(`[cron] Token retrieved:`, {
        access_token_preview: token.access_token?.slice(0, 20) + "...",
        has_refresh_token: !!token.refresh_token,
        refresh_token_preview: token.refresh_token?.slice(0, 20) + "...",
      });

      if (!token.refresh_token) {
        throw new Error(
          `No refresh token stored. The user must reconnect ${post.platform} to obtain a refresh token.`,
        );
      }

      if (post.platform === "tiktok") {
        // ── Refresh, then IMMEDIATELY persist, then publish ───────────────────
        // TikTok invalidates the old refresh_token on every refresh call and
        // issues a new one. The rotated token is persisted before anything else
        // is attempted so a later publish failure can never strand the user
        // with an already-invalidated refresh_token (see
        // openspec/changes/tiktok-publish/design.md, Decision 3).
        const refreshed = await refreshAccessToken(token.refresh_token);

        const { error: refreshUpsertErr } = await supabaseServer
          .from("platform_tokens")
          .upsert(
            {
              user_id: post.user_id,
              platform: "tiktok",
              access_token: refreshed.accessToken,
              refresh_token: refreshed.refreshToken,
              expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
            },
            { onConflict: "user_id,platform" },
          );

        if (refreshUpsertErr) {
          console.error(`[cron] Failed to persist refreshed TikTok token for post ${post.id}:`, refreshUpsertErr.message);
          throw new Error(`Failed to persist refreshed TikTok token: ${refreshUpsertErr.message}`);
        }

        console.log(`[cron] Calling publishToTikTok for post ${post.id}`);

        // ── Publish to TikTok (optimistic — no status polling, see Decision 1) ──
        const publishId = await publishToTikTok({
          accessToken: refreshed.accessToken,
          videoUrl: post.video_url,
          title: post.title,
          privacyLevel: post.tiktok_privacy_level,
          brandOrganicToggle: !!post.tiktok_brand_organic_toggle,
          brandContentToggle: !!post.tiktok_brand_content_toggle,
        });

        console.log(`[cron] ✓ Post ${post.id} published → TikTok publish ID: ${publishId}`);

        // ── Mark published and store TikTok publish ID ──────────────────────────
        await supabaseServer
          .from("posts")
          .update({
            status: "published",
            tiktok_publish_id: publishId,
            last_error: null,
            publish_started_at: null,
            publish_attempts: 0,
          })
          .eq("id", post.id);

        await cleanupPostVideo(post.id, post.video_url, post.asset_id);
        published++;
        continue;
      }

      const tags = post.tags
        ? post.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];

      console.log(`[cron] Calling uploadToYouTube for post ${post.id} with tags:`, tags);

      // ── Upload to YouTube ──────────────────────────────────────────────────
      const youtubeId = await uploadToYouTube({
        videoUrl: post.video_url,
        title: post.title,
        description: post.description ?? "",
        tags,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
      });

      console.log(`[cron] ✓ Post ${post.id} published → YouTube ID: ${youtubeId}`);

      // ── Mark published and store YouTube video ID ───────────────────────────
      await supabaseServer
        .from("posts")
        .update({
          status: "published",
          youtube_video_id: youtubeId,
          last_error: null,
          publish_started_at: null,
          publish_attempts: 0,
        })
        .eq("id", post.id);

      await cleanupPostVideo(post.id, post.video_url, post.asset_id);
      published++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`[cron] ✗ Post ${post.id} failed — message:`, message);
      if (stack) console.error(`[cron] Stack trace:`, stack);
      // Google API errors carry a .response.data field with the real reason
      const anyErr = err as Record<string, unknown>;
      if (anyErr?.response) {
        console.error(`[cron] Google API response status:`, (anyErr.response as Record<string, unknown>)?.status);
        console.error(`[cron] Google API response data:`, JSON.stringify((anyErr.response as Record<string, unknown>)?.data, null, 2));
      }

      // ── Decide retry vs give up ─────────────────────────────────────────────
      const attempts = (post.publish_attempts ?? 0) + 1;
      const permanent =
        post.platform === "tiktok" ? isTikTokPermanentFailure(err, message) : isPermanentFailure(err, message);
      const giveUp = permanent || attempts >= MAX_PUBLISH_ATTEMPTS;

      // Releasing the lock (publish_started_at = null) on a retry lets the next
      // tick re-claim and retry. A permanent error or an exhausted attempt count
      // lands the post in "failed".
      await supabaseServer
        .from("posts")
        .update({
          status: giveUp ? "failed" : "scheduled",
          last_error: message.slice(0, 1000),
          publish_started_at: null,
          publish_attempts: attempts,
        })
        .eq("id", post.id);

      if (giveUp) {
        console.error(
          `[cron] ✗ Post ${post.id} giving up (${permanent ? "permanent" : `${attempts}/${MAX_PUBLISH_ATTEMPTS} attempts`})`,
        );
        failed++;
      } else {
        console.warn(`[cron] ↻ Post ${post.id} transient fail, will retry (attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS})`);
        retried++;
      }
    }
  }

  return NextResponse.json({
    processed: posts.length,
    published,
    failed,
    retried,
    skipped,
  });
}
