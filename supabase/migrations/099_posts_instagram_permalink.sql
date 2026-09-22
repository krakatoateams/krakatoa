-- 099_posts_instagram_permalink.sql
-- Stores a real, clickable Instagram permalink once a post is confirmed
-- published, mirroring tiktok_share_url's role for the Calendar's "View on
-- Instagram" button (057_posts_tiktok_share_url.sql).
--
-- Fetched via GET /{media-id}?fields=permalink (lib/instagram.ts's
-- getMediaPermalink) right after media_publish succeeds in
-- app/api/cron/route.ts, best-effort — a failure to fetch it must never turn
-- a already-confirmed publish into a failed post, so this can legitimately
-- stay NULL even for a successfully published Instagram post.
--
-- Nullable and meaningful only for platform = 'instagram' rows; stays NULL
-- for every other platform.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists instagram_permalink text;

comment on column posts.instagram_permalink is
  'Real Instagram permalink (https://www.instagram.com/p/{shortcode}/ or /reel/...), fetched best-effort right after media_publish succeeds. NULL for non-Instagram rows, and can stay NULL even for a published Instagram post if the permalink fetch itself failed (non-blocking).';
