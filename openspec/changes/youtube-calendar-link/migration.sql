-- Run in Supabase SQL Editor before testing cron + calendar YouTube links
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_video_id text;
