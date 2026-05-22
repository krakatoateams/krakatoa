## Why

The scheduler dashboard (`/tools/scheduler`) is functional but lacks feedback loops: users upload a video and schedule it with no visibility into past posts, no instant preview of what they uploaded, and a scheduling suggestion that ignores the current day and time. These three gaps reduce trust and increase errors (wrong time, wrong video, blind scheduling).

## What Changes

- **Post Status List**: New "Your Recent Posts" section below the main form grid showing the last 5 posts with status badges, formatted timestamps, and action links (View on YouTube for published, Retry for failed). Auto-refreshes every 30 seconds. Links to calendar for full history.
- **Video Preview**: When a video file is selected, show an HTML5 preview player immediately using `URL.createObjectURL`. Display duration. Block scheduling if duration > 60 seconds with a warning.
- **Smarter Best Time**: Replace static "6:00 PM today" button with day-aware logic. Weekdays → 6 PM, Weekends → 10 AM. If today's slot has already passed, suggest tomorrow. Button label reflects reason ("Weekday evening · highest engagement").

## Capabilities

### New Capabilities

- `post-status-list`: Recent posts panel on scheduler dashboard with status, actions, and auto-refresh
- `video-preview`: Instant local video preview with duration validation and scheduling guard
- `smart-best-time`: Day-aware and time-aware best-time suggestion replacing static "6 PM today"

### Modified Capabilities

_(none — existing schedule form and upload flow remain intact)_

## Impact

- `app/tools/scheduler/page.tsx` — all changes are in this one file
- `app/api/posts/route.ts` — consumed by post status list (GET, already exists)
- No new dependencies required
- No API changes
- No database changes
