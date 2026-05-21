import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadToYouTube } from "@/lib/youtube";

/**
 * GET /api/cron
 *
 * Finds all posts whose scheduled_time has passed and status is still
 * "scheduled", then uploads each one to YouTube and marks it published/failed.
 *
 * Protection: when CRON_SECRET is set in env, requests must include
 *   Authorization: Bearer <CRON_SECRET>
 * When CRON_SECRET is absent (local dev), all requests are allowed.
 *
 * Compatible with Vercel Cron Jobs — add to vercel.json:
 *   { "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }] }
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

  // ── Fetch posts that are due ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: duePosts, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_time", now)
    .order("scheduled_time", { ascending: true });

  if (fetchErr) {
    console.error("[cron] failed to fetch posts:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = duePosts ?? [];
  console.log(`[cron] ${posts.length} post(s) due at ${now}`);

  if (posts.length === 0) {
    return NextResponse.json({ processed: 0, published: 0, failed: 0 });
  }

  let published = 0;
  let failed = 0;

  for (const post of posts) {
    console.log(`[cron] Processing post:`, {
      id: post.id,
      title: post.title,
      platform: post.platform,
      user_id: post.user_id,
      scheduled_time: post.scheduled_time,
      video_url: post.video_url,
    });

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
          "No refresh token stored. The user must sign in again with " +
          "the YouTube permission to obtain a refresh token.",
        );
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
        .update({ status: "published", youtube_video_id: youtubeId })
        .eq("id", post.id);

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

      await supabaseServer
        .from("posts")
        .update({ status: "failed" })
        .eq("id", post.id);

      failed++;
    }
  }

  return NextResponse.json({
    processed: posts.length,
    published,
    failed,
  });
}
