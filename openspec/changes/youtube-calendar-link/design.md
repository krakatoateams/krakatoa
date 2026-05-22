## Context

Cron calls `uploadToYouTube` which returns a YouTube video ID. Today only `status` is updated to `published`. Calendar modal links to `video_url` (Supabase storage).

## Goals

- Store `youtube_video_id` on successful publish
- Calendar modal shows `https://www.youtube.com/watch?v={id}` when available
- Keep `privacyStatus: unlisted` unchanged

## Non-Goals

- Backfilling IDs for posts published before this change
- Changing privacy to public
- Storing `failure_reason` on failed posts

## Decisions

- **Column name:** `youtube_video_id` (text, nullable) on `posts`
- **URL format:** `https://www.youtube.com/watch?v=${youtube_video_id}`
- **UI:** Primary "View on YouTube" when `status === 'published' && youtube_video_id`; secondary "View source video" for `video_url`

## Migration

Run in Supabase SQL Editor:

```sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_video_id text;
```
