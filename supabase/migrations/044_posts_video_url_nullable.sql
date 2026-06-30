-- 044_posts_video_url_nullable.sql
--
-- Allow video_url to be NULL on published posts.
-- After a post is successfully published to YouTube the source video file is
-- deleted from Supabase Storage to reclaim space; the post row itself is kept
-- intact (title, description, tags, youtube_video_id all remain).
--
-- Idempotent: ALTER COLUMN … DROP NOT NULL is a no-op when the column is
-- already nullable, and the UPDATE only touches rows that need it.

alter table posts alter column video_url drop not null;

-- Backfill: null out video_url for posts that are already published so the
-- "View source video" UI button hides correctly. Storage files for these rows
-- may or may not still exist — the UI just won't link to them either way.
update posts
set video_url = null
where status = 'published'
  and video_url is not null;
