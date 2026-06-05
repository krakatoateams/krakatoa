## Why

The scheduler today handles exactly one video at a time: upload → caption → schedule → repeat. Creators batching a week of Shorts must run the full flow N times. Bulk scheduling lets them drop up to 5 videos at once, edit each, and schedule them all in one pass — without leaving the existing single-video experience behind.

## What Changes

- Unify the scheduler page state around a `VideoItem[]` model. Single mode is simply `items.length === 1`; bulk mode is `items.length >= 2` (max 5). Mode is **derived**, never a manual toggle.
- Dropping 1 video keeps the current single-video layout and behavior. Dropping 2–5 auto-switches to a bulk layout with one card per video (individual title, tags, date, time, caption).
- Uploads run **sequentially** with per-video progress; per-card duration guard (≤ 60s).
- Caption "same for all" toggle: generate once from the first video that has a `videoUrl`, copy to all cards, still per-card editable.
- "Schedule All" saves via a client-side loop of the existing `POST /api/posts` (no new endpoint). Per-card status badges (Scheduled ✅ / Failed ❌ kept for retry) and a batch toast ("X/N scheduled").
- Auto-space suggestion banner (+1h between videos, from the first card's time) when 2+ videos share a time. Suggestion only — not automatic.
- Align the upload size limit: both the page and `app/api/upload/route.ts` cap at 50MB.

## Capabilities

### New Capabilities

- `bulk-scheduling`: Multi-video upload, per-card editing, batch caption, batch scheduling with partial-failure handling, and time auto-spacing on the existing scheduler page.

### Modified Capabilities

- _(none — no existing `openspec/specs/` baseline in-repo.)_

## Impact

- **Frontend:** `app/(app)/tools/scheduler/page.tsx` — new `VideoItem[]` model, multi-file upload, single/bulk layout switch, per-card components, batch scheduling, auto-space banner.
- **Backend:** `app/api/upload/route.ts` — size limit aligned to 50MB. No change to `app/api/posts/route.ts` (reused per-item) or `app/api/generate-caption/route.ts`.
- **Risk:** The single→`items[0]` refactor must preserve all existing caption Generate/Polish behavior and the `usedTranscript` warning. `DescriptionCard`/`ScheduleCard` internals are kept unchanged; only their data source changes.

## Implementation Sequencing

Built across four prompts, each leaving the app working:

1. **Prompt 1 (this change, first slice):** `VideoItem[]` model, multi-file sequential upload, mode switch, per-card cards + fields, per-card duration guard, 50MB alignment. Schedule All rendered but disabled.
2. **Prompt 2:** caption per card + "same for all" toggle + per-card `usedTranscript` warning.
3. **Prompt 3:** Schedule All (client loop, per-card status, partial failure, batch toast, partial `handleSuccess`, batch empty-caption confirm).
4. **Prompt 4:** auto-space suggestion banner (+1h).
