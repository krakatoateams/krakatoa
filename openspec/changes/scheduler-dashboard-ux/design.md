## Context

All changes are confined to `app/tools/scheduler/page.tsx` — a single large client component (~644 lines). The page uses a two-column grid: left (UploadCard + DescriptionCard), right (ScheduleCard sticky). State is managed locally with `useState`/`useCallback`, no external state library. The existing API (`GET /api/posts`) already returns all user posts, so no backend work is needed.

## Goals / Non-Goals

**Goals:**
- Add a post status list below the form grid using the existing `/api/posts` endpoint
- Show a local video preview immediately on file select using `URL.createObjectURL`
- Guard scheduling when video duration exceeds 60 seconds
- Replace the static best-time button with day-aware + time-aware logic

**Non-Goals:**
- Backend changes of any kind
- Retry-to-new-form flow (retry = PATCH to reset status to `scheduled`)
- Infinite scroll or pagination beyond "show 5, link to calendar"
- Persisting best-time preferences

## Decisions

**D1: Post list placement — full width below the grid**
The post list goes in a third row spanning the full `max-w-6xl` container, not nested inside the left column. Rationale: it is a distinct context (history, not creation); full width lets each row show title + time + status + action cleanly without wrapping.

**D2: Video preview source — `URL.createObjectURL(file)` at select time**
Show preview immediately when the file is selected, not after the Supabase upload completes. This gives instant feedback. The object URL is revoked in a `useEffect` cleanup to avoid memory leaks. The `<video>` element is rendered in the `UploadCard` component alongside the existing drop zone states.

**D3: Duration state lifted to page level**
`videoDuration` (`number | null`) lives in `SchedulerDashboardPage` alongside `file`, `videoUrl`, `uploadStatus`. It is passed down to `UploadCard` (to capture from `onLoadedMetadata`) and to `ScheduleCard` (to disable the submit button and show a warning). This avoids prop drilling through multiple levels and keeps `ScheduleCard`'s `isReady` logic in one place.

**D4: Best time — compute inside click handler, not at render**
`getBestTime()` is called when the button is clicked, so it always reflects the current time. Logic: determine weekday vs weekend, then check if today's optimal slot has passed. If `now.getHours() >= bestHour`, suggest tomorrow; otherwise today.

**D5: Retry = PATCH to reset status**
Failed post "Retry" calls `PATCH /api/posts/:id` with `{ status: 'scheduled' }`. Simple and consistent with the existing PATCH endpoint (used by calendar drag-and-drop). The next cron run picks it up. No new endpoints needed.

**D6: Post type for the list**
Define a minimal `Post` interface in the dashboard page (id, title, status, scheduled_time, youtube_video_id) — enough for the list. No shared type file needed; calendar has its own.

## Risks / Trade-offs

- **Object URL memory leak** → Mitigated by `URL.revokeObjectURL` in `useEffect` cleanup when `file` changes or component unmounts.
- **30s auto-refresh causes re-renders** → `useInterval` pattern (or `setInterval` in `useEffect`) only updates the posts list state; form state is separate, so typing is unaffected.
- **Duration `NaN` on corrupt files** → Guard with `isFinite(duration)` before setting state; show no warning if duration can't be determined.
- **Retry on a post with a broken `video_url`** → Will fail again at cron time. Acceptable for v1; user sees it fail again on calendar. A future improvement could pre-validate the URL before retrying.
