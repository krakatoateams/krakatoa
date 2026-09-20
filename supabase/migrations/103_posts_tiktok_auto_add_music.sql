-- 103_posts_tiktok_auto_add_music.sql
-- TikTok photo-post carousels previously always sent auto_add_music: true to
-- TikTok's Photo Post API (lib/tiktok.ts's initPhotoPost) with no way for the
-- user to opt out. This column makes it a real per-post choice.
--
-- Photo-post-only concept (TikTok video posts already have their own audio
-- track from the uploaded file) — always NULL for a video-platform post or a
-- TikTok video post. Missing/NULL is treated as `true` at publish time
-- (app/api/cron/route.ts), matching the previously-hardcoded behavior for
-- every pre-existing photo post.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists tiktok_auto_add_music boolean;

comment on column posts.tiktok_auto_add_music is
  'TikTok photo-post only: whether to let TikTok auto-add recommended music to the carousel. NULL for non-photo/non-TikTok posts, or a pre-existing photo post from before this column existed — treated as true (the old hardcoded behavior) at publish time.';
