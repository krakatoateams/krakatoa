-- YouTube privacy status (public / unlisted / private), chosen per post at
-- schedule time — mirrors posts.tiktok_privacy_level's pattern (nullable
-- text column, validated in the API layer, not a DB CHECK constraint; see
-- 045_posts_tiktok_fields.sql). NULL for existing rows and non-YouTube
-- posts; the cron publisher (app/api/cron/route.ts) falls back to "public"
-- for NULL so already-scheduled posts keep their current behavior.

alter table posts add column if not exists youtube_privacy_status text;

comment on column posts.youtube_privacy_status is
  'YouTube privacyStatus ("public" | "unlisted" | "private") chosen by the user at schedule time. NULL for non-YouTube posts and pre-existing rows (cron treats NULL as "public"). Validated in the API layer.';
