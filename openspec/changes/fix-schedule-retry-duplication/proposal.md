## Why

Multi-platform scheduling (`tiktok-publish`) lets one video target YouTube and TikTok at once. Scheduling fires one independent `POST /api/posts` per selected platform — correct and already idempotent at the DB/cron layer (see Context in design.md). But both scheduling entry points, `handleSubmit` (single mode) and `handleScheduleAll` (bulk mode) in `app/(app)/tools/scheduler/page.tsx`, track only **one aggregate `scheduleStatus` per video**, not one per platform. When one platform's `POST /api/posts` succeeds and another fails, the whole item is marked failed. Retrying (clicking "Schedule Post"/"Schedule All" again) re-submits **every** selected platform again — including the one that already succeeded — creating a second, independent `posts` row for it, which the cron will then publish a second time.

This was flagged as a known, accepted limitation when multi-select shipped (see the inline comment in `handleScheduleAll`), but on reflection it's cheap enough to actually fix rather than carry indefinitely, since duplicate publishes are user-visible and embarrassing (e.g. the same video posted twice to a creator's real YouTube channel).

## What Changes

- `VideoItem` (client-only draft state, not persisted) gains per-platform result tracking: which of its selected platforms already have a successfully-created `posts` row, versus which failed and still need submitting.
- `handleSubmit` (single mode) and `handleScheduleAll` (bulk mode) only `POST /api/posts` for platforms not already marked successful for that item. A retry (re-click) becomes a no-op for already-succeeded platforms and only resubmits the ones that failed.
- Bulk mode's per-card status display gains a per-platform breakdown when more than one platform is selected (e.g. "YouTube: Scheduled ✓ · TikTok: Failed ✗"), replacing the single aggregate badge only in that case — single-platform cards keep today's exact badge, unchanged.
- **No DB schema change, no migration, no cron change.** Confirmed by direct investigation (see design.md Context) that the `posts` table, `POST /api/posts`, and `GET /api/cron` are already correctly modeled as one row = one platform = one independent publish action, with their own working idempotency (`youtube_video_id` / `tiktok_publish_id`) and retry (`publish_attempts`, `MAX_PUBLISH_ATTEMPTS`) at that granularity. The duplication risk is entirely client-side bookkeeping, not a data-model gap.

## Capabilities

### New Capabilities
- None — this is a bug fix to the existing `tiktok-publish` scheduling flow, not a new capability.

### Modified Capabilities
- Scheduler UI's multi-platform scheduling (single + bulk) gains correct partial-failure retry semantics.

## Impact

- **Frontend only:** `app/(app)/tools/scheduler/page.tsx` — `VideoItem` interface, `handleSubmit`, `handleScheduleAll`, `BulkVideoCard`'s status display.
- **Backend:** none. `app/api/posts/route.ts` and `app/api/cron/route.ts` are unchanged — already correct.
- **DB:** none. No migration.
- **Out of scope (explicitly, per request):**
  - The credits system's separate, unrelated lack of request-level idempotency — not touched here.
  - Any new grouping concept for "posts scheduled together" (e.g. a `group_id`/`batch_id` column) — not needed to fix this bug; noted as a possible future nice-to-have in design.md's Alternatives, not part of this change.
  - Cron/publish-time retry logic — already correct, untouched.
