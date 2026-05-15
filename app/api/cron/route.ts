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
    try {
      // ── Get user's platform token ──────────────────────────────────────────
      const { data: token, error: tokenErr } = await supabaseServer
        .from("platform_tokens")
        .select("access_token, refresh_token")
        .eq("user_id", post.user_id)
        .eq("platform", post.platform)
        .single();

      if (tokenErr || !token) {
        throw new Error(
          `No ${post.platform} token for user ${post.user_id}. ` +
          "The user must sign in again to re-authorise.",
        );
      }

      if (!token.refresh_token) {
        throw new Error(
          "No refresh token stored. The user must sign in again with " +
          "the YouTube permission to obtain a refresh token.",
        );
      }

      const tags = post.tags
        ? post.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];

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

      // ── Mark published ─────────────────────────────────────────────────────
      await supabaseServer
        .from("posts")
        .update({ status: "published" })
        .eq("id", post.id);

      published++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ✗ Post ${post.id} failed:`, message);

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
