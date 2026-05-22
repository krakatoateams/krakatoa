## 1. Database

- [x] Document SQL migration: `ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_video_id text;`

## 2. Backend

- [x] Update cron route to save `youtube_video_id` when upload succeeds

## 3. Frontend

- [x] Extend calendar `Post` type with optional `youtube_video_id`
- [x] Add "View on YouTube" button in post modal when ID present; rename source link to "View source video"

## 4. Verify

- [x] Manual test: schedule post, run cron, confirm modal shows YouTube link (requires Supabase migration + new publish)
