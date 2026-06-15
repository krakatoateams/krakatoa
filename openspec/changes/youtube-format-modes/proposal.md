## Why

The scheduler is hard-gated to YouTube Shorts: it blocks any video longer than 60s, forces a 9:16 preview frame, and the caption generator always writes in Shorts style with `#Shorts`. But creators have **both** 9:16 short-form and 16:9 long-form content. Today a 16:9 video can't be scheduled (the 60s gate blocks it, and from ReelsGen the "Schedule to YouTube" button is hidden for 16:9 storyboard output). The 60s limit is also outdated — YouTube Shorts now allows up to 3 minutes.

YouTube auto-classifies Short vs regular video from aspect ratio + duration; we upload via the same `videos.insert` either way. So this is purely a UI/validation/caption concern: stop forcing everything to be a Short, and let each item declare its format.

## What Changes

- Add a per-card **format** toggle — **Short** | **Video** — in both single and bulk mode.
- **Auto-suggest** the format from captured metadata: `9:16 (portrait) AND ≤ 3 min → Short`; `16:9 (landscape) OR > 3 min → Video`. The user can override.
- Capture the video's **aspect ratio** (`videoWidth`/`videoHeight`) alongside duration (today only duration is captured).
- Replace the hard 60s scheduling block with **mode-aware, non-blocking warnings**:
  - Short + > 3 min → warn it will publish as a regular video, not a Short.
  - Short + non-vertical → warn Shorts should be 9:16 (warning only, not blocked).
  - Video → no duration/aspect warnings.
- **Adaptive preview frame**: 9:16 for Short, 16:9 for Video.
- **Mode-aware captions**: pass `format` to `/api/generate-caption`; Short keeps the punchy hook + `#Shorts` style, Video gets a longer-form description prompt without forced `#Shorts`.
- **Auto-append `#Shorts`** to the description when scheduling a Short (single + bulk), so YouTube's classification + discovery are reinforced.
- **ReelsGen**: show "Schedule to YouTube" for 16:9 storyboard output too (it defaults to Video via auto-suggest).

## Capabilities

### New Capabilities

- `youtube-format-modes`: Per-item Short/Video format selection with metadata-based auto-suggest, mode-aware validation warnings, adaptive preview, mode-aware caption generation, and automatic `#Shorts` tagging for Shorts.

### Modified Capabilities

- _(builds on `schedule-from-assets` / `bulk-scheduling`; relaxes their 60s Shorts guard into mode-aware warnings.)_

## Impact

- **Frontend:** `app/(app)/tools/scheduler/page.tsx` — `VideoItem` gains `format` + `aspect`; metadata capture records dimensions; `ScheduleCard` + `BulkVideoCard` get the toggle, mode-aware warnings, and adaptive preview; schedule handlers append `#Shorts` for Shorts. `app/(app)/tools/reels/page.tsx` — unhide the Schedule button for storyboard output.
- **Backend:** `app/api/generate-caption/route.ts` — accept an optional `format` and branch the prompt; no schema change.
- **Out of scope (deferred):** persisting `posts.format` column, hard-blocking non-vertical Shorts, and `privacyStatus` (`unlisted` → `public`) — all deferred to a later change.
- **Risk:** the 60s guard is load-bearing in both single and bulk readiness checks; relaxing it must not regress scheduling. Mitigation: scheduling no longer blocks on duration at all; warnings are purely advisory.
