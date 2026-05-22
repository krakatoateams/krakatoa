## 1. Types & Shared State

- [x] 1.1 Add `Post` interface to `page.tsx` (id, title, status, scheduled_time, youtube_video_id)
- [x] 1.2 Add `videoDuration` state (`number | null`) to `SchedulerDashboardPage`
- [x] 1.3 Add `onDurationChange` prop to `UploadCard` to report duration up to page

## 2. Video Preview

- [x] 2.1 Create a local object URL from `file` when file is selected; revoke on cleanup
- [x] 2.2 Render `<video>` player (max-h-200px, controls) in `UploadCard` when `uploadStatus === "done"` and object URL exists
- [x] 2.3 Capture duration via `onLoadedMetadata`; call `onDurationChange` prop
- [x] 2.4 Display formatted duration string below player (e.g. "0:42")

## 3. Duration Guard in ScheduleCard

- [x] 3.1 Accept `videoDuration` prop in `ScheduleCard`
- [x] 3.2 Show warning banner when `videoDuration > 60`: "⚠️ Video is Xs — YouTube Shorts requires under 60s"
- [x] 3.3 Include `videoDuration <= 60 || videoDuration === null` in `isReady` guard to disable submit button

## 4. Smarter Best Time — DEFERRED (will revisit when TikTok/IG are added)

- [ ] 4.1 Implement `getBestTime()` helper: returns `{ date, time, label }` based on current day + hour
- [ ] 4.2 Weekday (Mon–Fri): bestHour = 18, label = "Weekday evening · highest engagement"
- [ ] 4.3 Weekend (Sat–Sun): bestHour = 10, label = "Weekend morning · peak scroll time"
- [ ] 4.4 If current hour >= bestHour, use tomorrow's date; otherwise today
- [ ] 4.5 Call `getBestTime()` inside `handleBestTime` click handler (not at render)
- [ ] 4.6 Update button label to show dynamic time + reason

## 5. Post Status List

- [x] 5.1 Add `posts` state and `fetchPosts` function to page; call on mount and after `handleSuccess`
- [x] 5.2 Set up 30-second auto-refresh interval in `useEffect`; clear on unmount
- [x] 5.3 Build `RecentPostsCard` component: maps over posts, renders title + formatted time + status badge + action
- [x] 5.4 Status badges: blue (scheduled), green (published), red (failed), gray (draft)
- [x] 5.5 Published + youtube_video_id: render "View on YouTube" link
- [x] 5.6 Failed: render "Retry" button that PATCHes `{ status: 'scheduled' }` then refreshes list
- [x] 5.7 Empty state: "No posts yet. Schedule your first video above."
- [x] 5.8 Limit display to 5 posts; show "View all in Calendar →" link if more exist
- [x] 5.9 Place `RecentPostsCard` below the two-column grid in page layout
