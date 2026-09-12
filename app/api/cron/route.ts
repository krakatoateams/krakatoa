import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadToYouTube } from "@/lib/youtube";
import {
  refreshAccessToken,
  publishToTikTok,
  publishPhotoToTikTok,
  resolveOrigin,
  waitForTikTokPublishOutcome,
  getCreatorInfo,
  buildTikTokShareUrl,
  TikTokCreatorInfoError,
} from "@/lib/tiktok";
import { classifyTikTokCreatorInfoError } from "@/lib/tiktok-creator-info-pure";
import {
  ensureInstagramCompatibleImage,
  createMediaContainer,
  getContainerStatus,
  publishContainer,
  isInstagramPermanentFailure,
} from "@/lib/instagram";
import {
  assertPathOwnedByUser,
  resolveStoragePath,
  resolvePublishVideoUrl,
  signOwnedStoragePathForPublish,
} from "@/lib/storage-signed-url";
import { getAssetForProfile } from "@/lib/assets-db";
import { isVideoUrlConfirmedMissing, videoObjectExists } from "@/lib/video-storage";
import { cleanupPostVideo, cleanupPostPhotos } from "@/lib/post-storage-cleanup";
import {
  cronProcessingLogSafe,
  cronTokenLogSafe,
  isPermanentFailure,
  isTikTokPermanentFailure,
} from "@/lib/cron-publish-pure";

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

// Instagram's IN_PROGRESS container status isn't a failure and doesn't
// increment publish_attempts, so it can't use MAX_PUBLISH_ATTEMPTS (an
// attempt-count) to decide when to give up — this is a wall-clock budget
// instead, measured from posts.instagram_first_attempted_at (see
// openspec/changes/connect-instagram/design.md Decision 6, confirmed by the
// user at 10 minutes).
const INSTAGRAM_GIVE_UP_MS = 10 * 60 * 1000;

// TikTok's spam_risk_too_many_posts ("daily post cap reached") is explicitly
// a rolling daily cap, not a permanent block — and Kelolako's own core use
// case (scheduling many reels/day) makes hitting it a plausible routine
// occurrence, not a rare edge case. So it gets its own bounded wall-clock
// auto-retry (mirroring INSTAGRAM_GIVE_UP_MS's pattern) instead of the
// immediate-fail treatment used for a genuine account ban.
const TIKTOK_RATE_LIMIT_GIVE_UP_MS = 24 * 60 * 60 * 1000;
// Backoff between re-checks while auto-retrying a rate-limited post. Without
// this, the post would keep the oldest scheduled_time of anything due and
// win the shared MAX_POSTS_PER_RUN = 1 slot on every ~1-minute cron tick for
// up to 24 hours, starving every other user's due post. 15 minutes keeps
// re-checks comfortably granular (~96 over 24h) while cutting both that
// starvation risk and the load on TikTok's creator_info endpoint by ~15x.
const TIKTOK_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

/**
 * GET /api/cron
 *
 * Finds posts whose scheduled_time has passed and status is still "scheduled",
 * claims a bounded batch, publishes each to its platform, and marks it
 * published/failed.
 *
 * TikTok publish verification: Init succeeding only means TikTok *accepted*
 * the request — the real upload/download + publish happens asynchronously
 * afterward and can still fail there. After Init, this route polls TikTok's
 * status/fetch endpoint (bounded wait) before marking "published"; a real
 * FAILED status is stored as "failed" with TikTok's fail_reason, and a post
 * still processing past the wait budget is left "scheduled" (with its
 * publish_id already saved) to be re-checked — not re-published — next run.
 * On a confirmed PUBLISH_COMPLETE for a public (non-SELF_ONLY) post, TikTok
 * also returns a public post ID; this route builds a real share URL from it
 * (see openspec/changes/tiktok-view-on-tiktok) and stores it as
 * `posts.tiktok_share_url` for the Calendar's "View on TikTok" button — best
 * effort, never blocks the already-confirmed publish if it fails.
 * YouTube's upload is synchronous-complete, so no equivalent polling is
 * needed there.
 *
 * Instagram publish verification (openspec/changes/connect-instagram, Phase
 * 2): a container (POST /{ig-user-id}/media) publishes nothing on its own —
 * Instagram's own API refuses media_publish until the container reports
 * status_code = FINISHED, so (unlike TikTok) this is a structural
 * precondition, not just an added safety check. This route does exactly ONE
 * status check per cron tick (never an in-request polling loop — Meta's
 * recommended cadence, once/minute for up to 5 minutes, cannot fit this
 * route's maxDuration budget even once) — a container still IN_PROGRESS
 * leaves the post "scheduled" with instagram_container_id intact for the
 * next tick to re-check. A post stuck IN_PROGRESS for more than 10 minutes
 * wall-clock (posts.instagram_first_attempted_at) is given up on — a
 * separate budget from MAX_PUBLISH_ATTEMPTS, since "still processing" isn't
 * a failure and doesn't increment publish_attempts.
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
    // A post currently backing off a TikTok daily-cap hit steps out of the
    // way here so it can't win this shared MAX_POSTS_PER_RUN = 1 slot on
    // every tick for up to 24 hours — a no-op for every row that isn't
    // currently backed off (the column is null for everything else).
    .or(`tiktok_rate_limit_retry_after.is.null,tiktok_rate_limit_retry_after.lte.${now}`)
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
    console.log(`[cron] Processing post:`, cronProcessingLogSafe(post));

    // ── Claim-lock: only proceed if we win the conditional update. This blocks a
    //    concurrent/overlapping run from uploading the same post. A claim older
    //    than the stale window is treated as abandoned and re-claimable. ────────
    const { data: claimed, error: claimErr } = await supabaseServer
      .from("posts")
      .update({ publish_started_at: now })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .or(`publish_started_at.is.null,publish_started_at.lt.${staleCutoff}`)
      .select("id, youtube_video_id, tiktok_publish_id, tiktok_rate_limited_first_attempted_at, instagram_container_id, instagram_media_id, instagram_first_attempted_at")
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
    // YouTube's upload is synchronous-complete once youtube_video_id exists —
    // safe to mark published immediately. TikTok's tiktok_publish_id can exist
    // WITHOUT confirmed completion (Init succeeded on a prior tick, but our
    // own status poll below hit its wait budget before a terminal status came
    // back) — that case must re-check status rather than blindly trust it, so
    // it's handled inside the TikTok branch below instead of short-circuited
    // here.
    if (post.platform !== "tiktok" && claimed.youtube_video_id) {
      console.log(`[cron] Post ${post.id} already has a youtube publish ID — marking published, no re-upload`);
      await supabaseServer
        .from("posts")
        .update({ status: "published", last_error: null, publish_started_at: null, publish_attempts: 0 })
        .eq("id", post.id);
      await cleanupPostVideo(post.id, post.video_url, post.asset_id);
      await cleanupPostPhotos(post.id, post.photo_urls);
      published++;
      continue;
    }

    try {
      // ── Get user's platform token ──────────────────────────────────────────
      const { data: token, error: tokenErr } = await supabaseServer
        .from("platform_tokens")
        .select("access_token, refresh_token, platform_user_id")
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

      console.log(`[cron] Token retrieved:`, cronTokenLogSafe(token));

      // Instagram has no refresh_token concept at all (its long-lived
      // access_token refreshes itself via a separate proactive cron — see
      // openspec/changes/connect-instagram/design.md Decision 2b) — its
      // platform_tokens row always has refresh_token = null by design, so
      // this check must not apply to it.
      if (post.platform !== "instagram" && !token.refresh_token) {
        throw new Error(
          `No refresh token stored. The user must reconnect ${post.platform} to obtain a refresh token.`,
        );
      }

      // A TikTok or Instagram post is a photo post exactly when photo_urls is
      // populated — no separate post-type column (see openspec/changes/
      // tiktok-photo-post). Computed up front (not just inside each platform
      // branch below) because the video-existence-check + resolvePublishVideoUrl
      // block right below is video-only and must be skipped for photo posts.
      // Instagram photo posts are single-image only (no carousel support —
      // see connect-instagram/design.md Non-Goals), so only photo_urls[0] is
      // ever used for Instagram even if more are present.
      const isPhotoPost =
        (post.platform === "tiktok" || post.platform === "instagram") &&
        Array.isArray(post.photo_urls) && post.photo_urls.length > 0;

      // ── Re-verify the video still exists before spending a publish attempt ──
      // Catches the case where the file was deleted/swept sometime between
      // scheduling and now (see openspec/changes/video-existence-check).
      // Skipped entirely for a photo post: it has no video_url/video asset to
      // check, and resolvePublishVideoUrl would otherwise unconditionally
      // throw "No publishable video location for this post." for every photo
      // post — this was the root cause of photo posts failing after 3
      // retries while video posts succeeded (see bug investigation, cron
      // ran this block before the photo/video branch existed).
      let publishVideoUrl: string | null = null;
      if (!isPhotoPost) {
        let assetStoragePath: string | null = null;
        if (post.asset_id && post.profile_id) {
          const asset = await getAssetForProfile(post.profile_id, post.asset_id);
          assetStoragePath = asset?.storage_path ?? null;
        }

        const storagePath = resolveStoragePath(assetStoragePath, post.video_url);
        if (storagePath) {
          const exists = await videoObjectExists(storagePath);
          if (exists === false) {
            throw new Error(
              "Video file no longer exists in storage — it was deleted or swept before publishing.",
            );
          }
        } else if (await isVideoUrlConfirmedMissing(post.video_url)) {
          throw new Error(
            "Video file no longer exists in storage — it was deleted or swept before publishing.",
          );
        }

        publishVideoUrl = await resolvePublishVideoUrl({
          videoUrl: post.video_url,
          assetStoragePath,
          userId: post.user_id,
        });
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

        // ── Publish to TikTok, or resume checking a prior attempt ────────────────
        // claimed.tiktok_publish_id is set when a previous tick's Init call
        // succeeded but the status poll below hit its wait budget before a
        // terminal status came back (see the idempotency comment above) —
        // in that case, skip straight to re-polling instead of calling Init
        // again, which would otherwise create a duplicate post on TikTok.
        let publishId = claimed.tiktok_publish_id ?? null;

        if (!publishId) {
          console.log(
            `[cron] Calling ${isPhotoPost ? "publishPhotoToTikTok" : "publishToTikTok"} for post ${post.id}`,
          );

          try {
            if (isPhotoPost) {
              for (const raw of post.photo_urls ?? []) {
                const path = resolveStoragePath(null, raw);
                if (path) await assertPathOwnedByUser(path, post.user_id);
              }
            }
            publishId = isPhotoPost
              ? await publishPhotoToTikTok({
                  accessToken: refreshed.accessToken,
                  photoUrls: post.photo_urls,
                  title: post.title,
                  description: post.description ?? "",
                  privacyLevel: post.tiktok_privacy_level,
                  brandOrganicToggle: !!post.tiktok_brand_organic_toggle,
                  brandContentToggle: !!post.tiktok_brand_content_toggle,
                  disableComment: !!post.tiktok_disable_comment,
                  origin: resolveOrigin(req),
                })
              : await publishToTikTok({
                  accessToken: refreshed.accessToken,
                  // Non-null: this branch only runs when !isPhotoPost, which is
                  // exactly when publishVideoUrl was computed above.
                  videoUrl: publishVideoUrl!,
                  title: post.title,
                  privacyLevel: post.tiktok_privacy_level,
                  brandOrganicToggle: !!post.tiktok_brand_organic_toggle,
                  brandContentToggle: !!post.tiktok_brand_content_toggle,
                  disableComment: !!post.tiktok_disable_comment,
                  disableDuet: !!post.tiktok_disable_duet,
                  disableStitch: !!post.tiktok_disable_stitch,
                });
          } catch (publishErr) {
            // spam_risk_too_many_posts (daily cap) gets its own bounded
            // wall-clock auto-retry, handled entirely here — it never
            // reaches the outer generic catch, and never increments
            // publish_attempts while still within budget, exactly like
            // Instagram's IN_PROGRESS handling below (this isn't a failure,
            // it's an expected wait). Anything else — including a genuine
            // ban (spam_risk_user_banned_from_posting) — is re-thrown so the
            // outer catch's existing isTikTokPermanentFailure/last_error/
            // Retry-button machinery handles it unchanged.
            if (publishErr instanceof TikTokCreatorInfoError) {
              const cls = classifyTikTokCreatorInfoError(publishErr.code);
              if (cls.severity === "rate_limited") {
                const firstAttemptedAt = claimed.tiktok_rate_limited_first_attempted_at ?? null;
                const elapsedMs = firstAttemptedAt ? Date.now() - new Date(firstAttemptedAt).getTime() : 0;
                const giveUp = !!firstAttemptedAt && elapsedMs >= TIKTOK_RATE_LIMIT_GIVE_UP_MS;

                if (giveUp) {
                  await supabaseServer
                    .from("posts")
                    .update({
                      status: "failed",
                      last_error:
                        "TikTok's daily post cap kept blocking this post for over 24 hours — please retry manually once you've confirmed the cap has cleared.",
                      publish_started_at: null,
                      publish_attempts: (post.publish_attempts ?? 0) + 1,
                      tiktok_rate_limited_first_attempted_at: null,
                      tiktok_rate_limit_retry_after: null,
                    })
                    .eq("id", post.id);
                  console.error(`[cron] ✗ Post ${post.id} — TikTok daily cap never cleared within 24h, giving up`);
                  failed++;
                } else {
                  await supabaseServer
                    .from("posts")
                    .update({
                      status: "scheduled",
                      last_error: cls.message,
                      publish_started_at: null,
                      tiktok_rate_limited_first_attempted_at: firstAttemptedAt ?? new Date().toISOString(),
                      tiktok_rate_limit_retry_after: new Date(Date.now() + TIKTOK_RATE_LIMIT_BACKOFF_MS).toISOString(),
                    })
                    .eq("id", post.id);
                  console.warn(`[cron] ⏳ Post ${post.id} — TikTok daily post cap reached, auto-retrying within 24h`);
                  skipped++;
                }
                continue;
              }
            }
            throw publishErr;
          }

          console.log(`[cron] Init succeeded for post ${post.id} → TikTok publish ID: ${publishId}`);

          // Persist the ID immediately — before we know the final outcome —
          // so a retry (this tick's poll timing out, or a later tick) never
          // re-calls Init and creates a duplicate TikTok post.
          await supabaseServer.from("posts").update({ tiktok_publish_id: publishId }).eq("id", post.id);
        } else {
          console.log(
            `[cron] Post ${post.id} already has TikTok publish ID ${publishId} from a prior attempt — re-checking status instead of re-publishing`,
          );
        }

        // ── Verify TikTok actually completed the publish before trusting it ──
        // Init only means TikTok accepted the request; the real upload/
        // download + publish happens asynchronously and can still fail (see
        // openspec/changes/tiktok-photo-post bug history — a post sat
        // "published" in our DB while TikTok's real status was FAILED with
        // file_format_check_failed).
        const outcome = await waitForTikTokPublishOutcome(refreshed.accessToken, publishId);

        if (outcome.outcome === "failed") {
          await supabaseServer
            .from("posts")
            .update({
              status: "failed",
              last_error: `TikTok rejected this post: ${outcome.failReason}`.slice(0, 1000),
              publish_started_at: null,
              publish_attempts: (post.publish_attempts ?? 0) + 1,
            })
            .eq("id", post.id);
          console.error(`[cron] ✗ Post ${post.id} — TikTok reported FAILED (${outcome.failReason})`);
          failed++;
          continue;
        }

        if (outcome.outcome === "pending") {
          // Separate edge case (not a failure, not a success): TikTok hasn't
          // finished processing within our poll budget. Don't block
          // indefinitely — leave the post "scheduled" (tiktok_publish_id is
          // already saved above, so the next tick re-checks status instead
          // of re-calling Init) and release the claim so it can be picked up
          // again.
          console.warn(
            `[cron] ⏳ Post ${post.id} still processing on TikTok (last status: ${outcome.lastStatus}) — will recheck next run`,
          );
          await supabaseServer
            .from("posts")
            .update({
              last_error: `Still processing on TikTok (status: ${outcome.lastStatus}) — checking again automatically.`,
              publish_started_at: null,
            })
            .eq("id", post.id);
          skipped++;
          continue;
        }

        // outcome.outcome === "complete"
        console.log(`[cron] ✓ Post ${post.id} confirmed published on TikTok (publish ID: ${publishId})`);

        // A share URL only exists for a public (non-SELF_ONLY) post — TikTok
        // only returns publicaly_available_post_id for public viewership.
        // Best-effort: a failure fetching the username must never turn an
        // already-confirmed publish into a failed post.
        let shareUrl: string | null = null;
        if (outcome.publicPostId) {
          try {
            const creator = await getCreatorInfo(refreshed.accessToken);
            shareUrl = buildTikTokShareUrl(creator.creatorUsername, outcome.publicPostId);
          } catch (err) {
            console.warn(`[cron] Post ${post.id} — failed to build TikTok share URL (non-blocking):`, err);
          }
        }

        await supabaseServer
          .from("posts")
          .update({
            status: "published",
            last_error: null,
            publish_started_at: null,
            publish_attempts: 0,
            tiktok_share_url: shareUrl,
            tiktok_rate_limited_first_attempted_at: null,
            tiktok_rate_limit_retry_after: null,
          })
          .eq("id", post.id);

        await cleanupPostVideo(post.id, post.video_url, post.asset_id);
        await cleanupPostPhotos(post.id, post.photo_urls);
        published++;
        continue;
      }

      if (post.platform === "instagram") {
        // ── Idempotency: already fully published ──────────────────────────
        if (claimed.instagram_media_id) {
          console.log(`[cron] Post ${post.id} already has an Instagram media ID — marking published, no re-publish`);
          await supabaseServer
            .from("posts")
            .update({ status: "published", last_error: null, publish_started_at: null, publish_attempts: 0 })
            .eq("id", post.id);
          await cleanupPostVideo(post.id, post.video_url, post.asset_id);
          await cleanupPostPhotos(post.id, post.photo_urls);
          published++;
          continue;
        }

        // Set at connect time (app/api/connections/instagram/callback) —
        // required to scope /media and /media_publish under the right
        // account. Absence here means the user connected before this field
        // was persisted (a Phase 1 gap fixed alongside this Phase 2 work) —
        // surfaced as a clear reconnect-needed error rather than a confusing
        // API failure.
        if (!token.platform_user_id) {
          throw new Error(
            "No Instagram account ID stored for this connection. The user must reconnect Instagram to re-authorize.",
          );
        }
        const igUserId = token.platform_user_id;

        let containerId: string | null = claimed.instagram_container_id ?? null;
        const firstAttemptedAt = claimed.instagram_first_attempted_at ?? null;

        // ── 10-minute wall-clock give-up (design.md Decision 6) ────────────
        // Independent of MAX_PUBLISH_ATTEMPTS, which counts thrown errors —
        // "still IN_PROGRESS" is neither a failure nor something that
        // increments publish_attempts.
        if (containerId && firstAttemptedAt && Date.now() - new Date(firstAttemptedAt).getTime() > INSTAGRAM_GIVE_UP_MS) {
          await supabaseServer
            .from("posts")
            .update({
              status: "failed",
              last_error: "Instagram hasn't finished processing this post after 10 minutes — giving up. It may still complete on Instagram's side independently of this app; check the account directly if needed.",
              publish_started_at: null,
              publish_attempts: (post.publish_attempts ?? 0) + 1,
              instagram_container_id: null,
              instagram_first_attempted_at: null,
            })
            .eq("id", post.id);
          console.error(`[cron] ✗ Post ${post.id} — Instagram container stuck IN_PROGRESS past the 10-minute give-up threshold`);
          failed++;
          continue;
        }

        if (!containerId) {
          // ── Create the container (or resume checking a prior attempt) ───
          const mediaType: "IMAGE" | "REELS" = isPhotoPost ? "IMAGE" : "REELS";
          let mediaUrl: string;

          if (isPhotoPost) {
            // Single-image only (design.md Non-Goals) — always the first
            // photo, same simplification TikTok's own cover-photo handling
            // uses elsewhere in this codebase.
            const rawPhoto = post.photo_urls[0];
            const photoStoragePath = resolveStoragePath(null, rawPhoto);
            if (!photoStoragePath) {
              throw new Error("Instagram photo post has no resolvable storage path.");
            }
            await assertPathOwnedByUser(photoStoragePath, post.user_id);
            const compatiblePath = await ensureInstagramCompatibleImage(photoStoragePath);
            mediaUrl = await signOwnedStoragePathForPublish(compatiblePath, post.user_id);
          } else {
            // Non-null: isPhotoPost is false here, exactly when
            // publishVideoUrl was computed by the shared block above.
            mediaUrl = publishVideoUrl!;
          }

          console.log(`[cron] Creating Instagram ${mediaType} container for post ${post.id}`);
          const created = await createMediaContainer({
            igUserId,
            accessToken: token.access_token,
            mediaType,
            mediaUrl,
            caption: post.description ?? "",
          });
          containerId = created.containerId;

          // Persist immediately — before polling — so a mid-poll timeout or
          // crash resumes on the next tick instead of creating a duplicate
          // container. instagram_first_attempted_at is set once and never
          // overwritten on later resumes (mirrors the give-up check reading
          // it as a fixed starting point).
          await supabaseServer
            .from("posts")
            .update({
              instagram_container_id: containerId,
              instagram_first_attempted_at: firstAttemptedAt ?? new Date().toISOString(),
            })
            .eq("id", post.id);
        } else {
          console.log(
            `[cron] Post ${post.id} already has Instagram container ${containerId} from a prior attempt — re-checking status instead of recreating`,
          );
        }

        // ── One status check this tick — never an in-request polling loop ──
        const statusCode = await getContainerStatus(token.access_token, containerId);
        console.log(`[cron] Instagram container ${containerId} status: ${statusCode}`);

        if (statusCode === "ERROR" || statusCode === "EXPIRED") {
          await supabaseServer
            .from("posts")
            .update({
              status: "failed",
              last_error: `Instagram reported ${statusCode} while processing this post.`,
              publish_started_at: null,
              publish_attempts: (post.publish_attempts ?? 0) + 1,
              // Neither status can ever recover — a retry must create a
              // fresh container, not re-poll a dead one.
              instagram_container_id: null,
              instagram_first_attempted_at: null,
            })
            .eq("id", post.id);
          console.error(`[cron] ✗ Post ${post.id} — Instagram container ${statusCode}`);
          failed++;
          continue;
        }

        if (statusCode !== "FINISHED") {
          // IN_PROGRESS (or an unrecognized/PUBLISHED-without-our-own-
          // media_publish edge case — see design.md Risks) — not terminal,
          // don't block. Release the claim; instagram_container_id +
          // instagram_first_attempted_at stay so the next tick re-checks
          // status instead of recreating the container.
          console.warn(`[cron] ⏳ Post ${post.id} still processing on Instagram (status: ${statusCode}) — will recheck next run`);
          await supabaseServer
            .from("posts")
            .update({
              last_error: `Still processing on Instagram (status: ${statusCode}) — checking again automatically.`,
              publish_started_at: null,
            })
            .eq("id", post.id);
          skipped++;
          continue;
        }

        // statusCode === "FINISHED"
        const { mediaId } = await publishContainer(igUserId, token.access_token, containerId);
        console.log(`[cron] ✓ Post ${post.id} published → Instagram media ID: ${mediaId}`);

        await supabaseServer
          .from("posts")
          .update({
            status: "published",
            instagram_media_id: mediaId,
            last_error: null,
            publish_started_at: null,
            publish_attempts: 0,
          })
          .eq("id", post.id);

        await cleanupPostVideo(post.id, post.video_url, post.asset_id);
        await cleanupPostPhotos(post.id, post.photo_urls);
        published++;
        continue;
      }

      const tags = post.tags
        ? post.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];

      console.log(`[cron] Calling uploadToYouTube for post ${post.id} with tags:`, tags);

      // ── Upload to YouTube ──────────────────────────────────────────────────
      // Non-null: YouTube posts are never photo posts (isPhotoPost is
      // platform==="tiktok"-gated), so publishVideoUrl was always computed.
      const youtubeId = await uploadToYouTube({
        videoUrl: publishVideoUrl!,
        title: post.title,
        description: post.description ?? "",
        tags,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        // NULL on older rows (scheduled before this field existed) — fall
        // back to "public", the prior hardcoded behavior.
        privacyStatus: (post.youtube_privacy_status as "public" | "unlisted" | "private" | null) ?? "public",
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
      await cleanupPostPhotos(post.id, post.photo_urls);
      published++;
    } catch (err) {
      // A classified TikTok creator-info error (currently only the "banned"
      // severity reaches here — rate_limited is fully handled inline in the
      // TikTok branch above) gets its friendly message, not TikTok's raw
      // error string.
      const message =
        err instanceof TikTokCreatorInfoError
          ? classifyTikTokCreatorInfoError(err.code).message
          : err instanceof Error
            ? err.message
            : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      console.error(`[cron] ✗ Post ${post.id} failed — message:`, message);
      if (stack) console.error(`[cron] Stack trace:`, stack);
      const anyErr = err as Record<string, unknown>;
      if (anyErr?.response) {
        console.error(
          `[cron] Google API response status:`,
          (anyErr.response as Record<string, unknown>)?.status,
        );
      }

      // ── Decide retry vs give up ─────────────────────────────────────────────
      const attempts = (post.publish_attempts ?? 0) + 1;
      const permanent =
        post.platform === "tiktok"
          ? isTikTokPermanentFailure(err, message)
          : post.platform === "instagram"
            ? isInstagramPermanentFailure(err, message)
            : isPermanentFailure(err, message);
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
          // Only set on the transition INTO "failed" — this is what the
          // 7-day storage safety-net cleanup queries against. Left untouched
          // on a transient retry (status stays "scheduled").
          ...(giveUp ? { failed_at: new Date().toISOString() } : {}),
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
