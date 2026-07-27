import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { cleanupPostVideo, cleanupPostPhotos } from "@/lib/post-storage-cleanup";

// Reads a small batch + a handful of storage deletes — comfortable headroom.
export const maxDuration = 60;

const DEFAULT_MIN_FAILED_DAYS = 7;
const BATCH_LIMIT = 50;

/**
 * GET /api/cron/cleanup-failed-posts
 *
 * Storage-cost safety net: posts that gave up (status = "failed", after
 * exhausting retries or a permanent error — see app/api/cron/route.ts) keep
 * their source media in Storage indefinitely, on purpose, so the user can
 * retry/reschedule without needing to re-upload. This sweep reclaims that
 * storage for posts abandoned in "failed" for longer than the threshold —
 * the post row and its metadata (title, last_error, etc.) are left intact;
 * only the source video_url/photo_urls files are deleted, same as a normal
 * post-publish cleanup.
 *
 * Never touches a post still within its normal retry window: only rows with
 * status = 'failed' AND a failed_at timestamp older than the threshold
 * qualify. failed_at is set exactly once, when cron gives up
 * (app/api/cron/route.ts), and is cleared back to null the moment a failed
 * post is re-armed for retry (app/api/posts/[id]/route.ts's PATCH handler) —
 * so an actively-retried post is never a candidate here, regardless of how
 * old its *original* failure was.
 *
 * Query params:
 *   - dryRun=1       → report which posts would be cleaned, delete nothing
 *   - minDays=NN     → override the age threshold (default 7)
 *
 * Protection: when CRON_SECRET is set, requests must include
 *   Authorization: Bearer <CRON_SECRET>
 * When CRON_SECRET is absent (local dev), all requests are allowed.
 *
 * Schedule via vercel.json crons (daily is plenty for a 7-day threshold).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  // Same "absent param must not become 0" guard as storage-sweep's minAgeHours.
  const minDaysParam = searchParams.get("minDays");
  const rawDays = minDaysParam === null ? NaN : Number(minDaysParam);
  const minDays = Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : DEFAULT_MIN_FAILED_DAYS;

  const cutoff = new Date(Date.now() - minDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: fetchErr } = await supabaseServer
    .from("posts")
    .select("id, video_url, photo_urls, asset_id, failed_at")
    .eq("status", "failed")
    .not("failed_at", "is", null)
    .lt("failed_at", cutoff)
    .limit(BATCH_LIMIT);

  if (fetchErr) {
    console.error("[cleanup-failed-posts] failed to fetch candidates:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const posts = candidates ?? [];
  console.log(`[cleanup-failed-posts] dryRun=${dryRun} minDays=${minDays} candidates=${posts.length}`);

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      minDays,
      candidateCount: posts.length,
      candidates: posts.map((p) => ({ id: p.id, failed_at: p.failed_at })),
    });
  }

  let cleaned = 0;
  for (const post of posts) {
    await cleanupPostVideo(post.id, post.video_url, post.asset_id);
    await cleanupPostPhotos(post.id, post.photo_urls);
    cleaned++;
  }

  console.log(`[cleanup-failed-posts] cleaned=${cleaned}`);

  return NextResponse.json({ dryRun: false, minDays, candidateCount: posts.length, cleaned });
}
