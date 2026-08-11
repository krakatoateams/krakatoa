-- 057_posts_tiktok_share_url.sql
-- Stores a real, clickable TikTok permalink once a post is confirmed published
-- publicly (openspec/changes/tiktok-view-on-tiktok).
--
-- Background: TikTok's status-fetch endpoint (POST /v2/post/publish/status/
-- fetch/) only returns a `publicaly_available_post_id` once status =
-- PUBLISH_COMPLETE AND the post's privacy_level is public (not SELF_ONLY) —
-- per TikTok's own docs, "returned only if the post is published for public
-- viewership." Every post published while this app was Sandbox-only was
-- necessarily SELF_ONLY (unaudited apps are restricted to it), so this field
-- was never populated in practice until now. app/api/cron/route.ts builds
-- `https://www.tiktok.com/@{username}/video/{publicPostId}` from it (via
-- lib/tiktok.ts's buildTikTokShareUrl) and stores the result here, mirroring
-- youtube_video_id / tiktok_publish_id's role for their own "View on X"
-- buttons.
--
-- Nullable and meaningful only for platform = 'tiktok' rows that were public;
-- stays NULL for YouTube rows, and for any TikTok post published SELF_ONLY
-- (there's simply nothing to link to in that case).
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists tiktok_share_url text;

comment on column posts.tiktok_share_url is
  'Real TikTok permalink (https://www.tiktok.com/@{username}/video/{id}), populated only once a post is confirmed PUBLISH_COMPLETE with a public (non-SELF_ONLY) privacy_level. NULL for YouTube rows and for SELF_ONLY TikTok posts (no public post ID exists to link to).';
