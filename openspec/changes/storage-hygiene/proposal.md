## Why

The Supabase Storage bucket filled up (1.20 GB against the free-tier 1 GB cap), blocking new uploads/generations. An audit found **99% of usage in `videos/`**, and **51 of 68 video files (1.04 GB) were orphans** — device uploads that were added to the scheduler for testing but never scheduled, so no `posts`/`user_creations`/`storyboards` row references them. Nothing in the codebase ever deletes storage objects except transient `.srt` subtitle files, so the bucket only ever grows.

A one-time manual cleanup already reclaimed the 1.04 GB. This change prevents the bucket from filling again by adding an automated sweep, so storage becomes self-healing instead of requiring manual intervention.

## What Changes

- Add a protected cron endpoint `GET /api/cron/storage-sweep` that deletes, from the `videos/` folder:
  - files under `videos/temp/` (transient by design), and
  - **orphan** files (not referenced by any `posts.video_url`, `user_creations.media_url`/`storage_path`, or `storyboards.video_url`/`storyboard_url`)
  - **only when older than a safety age threshold (default 24h)** so in-progress uploads (drop → caption → schedule, which happens within minutes) are never touched.
- Extract the reference-checking + age logic into `lib/storage-sweep.ts` so it is unit-testable and the route stays thin.
- Support a `?dryRun=1` query param that reports what *would* be deleted without deleting, for safe verification in production.
- Protect the endpoint with the existing `CRON_SECRET` Bearer pattern (same as `/api/cron`).
- Add `vercel.json` with a **daily** cron schedule for the sweep (24h threshold tolerates daily cadence).

**Upload flow is intentionally unchanged.** We keep uploading on drop (rather than deferring upload until "Schedule" is pressed) because **caption generation depends on a hosted public URL**: the server hands `videoUrl` to Rendi, an external service that fetches the file to extract audio. A local browser `blob:` URL is unreachable by Rendi, so deferring the upload would break "Generate Caption" before scheduling. The sweep's age guard is what makes immediate-upload safe against orphan buildup.

## Capabilities

### New Capabilities

- `storage-hygiene`: An automated, age-guarded sweep that removes transient and orphaned video objects from Supabase Storage, with a dry-run mode and secret-protected trigger.

### Modified Capabilities

- _(none — upload, caption, and scheduling behavior are unchanged.)_

## Impact

- **Backend:** new `app/api/cron/storage-sweep/route.ts`; new `lib/storage-sweep.ts`. Reads `user_creations`, `posts`, `storyboards`; lists + removes objects under `videos/` in bucket `STORAGE_BUCKET`.
- **Config:** new `vercel.json` cron entry; relies on existing `CRON_SECRET`.
- **Out of scope (deferred):** deferring upload-until-schedule (rejected — breaks caption gen), product-photo (`photos/`) sweep, user-facing "delete creation" / retention of old creations (Block C), and migrating storage to Cloudflare R2 (recorded as a future alternative in design.md).
- **Risk:** accidental deletion of a referenced/in-progress file. Mitigations: conservative reference match (path + filename fallback), age guard (default 24h), and `?dryRun=1` for verification before the first real run.
