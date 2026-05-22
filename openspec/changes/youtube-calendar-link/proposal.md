## Why

After the cron publishes a scheduled post to YouTube, users see "Published" on the calendar but can only open the Supabase source file—not the YouTube watch URL. The YouTube video ID is returned by the API but never persisted.

## What Changes

- Add `youtube_video_id` column to `posts` table
- Save YouTube video ID when cron upload succeeds
- Show "View on YouTube" link in calendar post modal for published posts with an ID
- Rename/clarify existing link as source video (Supabase storage)
- Keep upload privacy as **unlisted** (no change to `lib/youtube.ts` privacy)

## Capabilities

### New Capabilities

- `scheduler-youtube-link`: Persist YouTube video ID after publish and surface watch link in scheduler calendar UI

### Modified Capabilities

_(none)_

## Impact

- Supabase `posts` schema (new nullable column)
- `app/api/cron/route.ts`
- `app/tools/scheduler/calendar/page.tsx`
- SQL migration note for manual Supabase column add
