## Why

Investigated a scheduling failure (2026-07-13): two "testing scheduler" posts (YouTube + TikTok) pointed at `videos/video_1782820848577.mp4`, a Text-to-Video output generated 2026-06-30. The file no longer exists in the Supabase Storage bucket — confirmed by fetching the public URL directly, which returns `{"statusCode":"404","error":"not_found"}` wrapped in an HTTP 400 by Supabase's storage gateway. Both `lib/youtube.ts` and `lib/tiktok.ts` surface this as a generic `Could not fetch video from storage (HTTP 400)` error.

Two gaps let this happen silently and expensively:
- **Nothing checks the video still exists when a post is scheduled.** The `posts` row (and the `user_creations`/`asset` row it points at) can outlive the actual storage object indefinitely — the object can vanish (e.g. `storage-sweep`, manual cleanup) long after scheduling, with no signal to the user until publish time.
- **`app/api/cron/route.ts`'s retry classifier treats a missing file as transient.** Neither `isPermanentFailure` nor `isTikTokPermanentFailure` recognizes "could not fetch video from storage" as permanent, so the cron burned all `MAX_PUBLISH_ATTEMPTS` (3) retrying against a file that could never come back, before finally giving up with the same unhelpful generic message.

This change closes both gaps: check existence before scheduling, re-check right before publishing, and classify a missing-video failure as permanent so it fails fast with an actionable message instead of retrying blindly.

## What Changes

- Add a shared existence-check helper (in `lib/storage-buckets.ts`) that asks Supabase's Storage API directly (via `storage.list()`, not a CDN fetch) whether an object at a given bucket-relative path actually exists. Reuses the same `/object/public/<bucket>/` URL-parsing logic already duplicated in `app/api/cron/route.ts` (`storagePathFromPublicUrl`), lifted into the shared module so both the new create-time check and the existing cron cleanup use one implementation.
- **Schedule-create time** (`app/api/posts/route.ts` `POST`): after resolving the final `video_url` (manual or asset-derived) and before inserting the post, run the existence check. If the URL parses to our own bucket and the object is confirmed absent, reject with `422 { error: "Video file no longer exists in storage. Please re-upload or regenerate the video." }`. A URL we can't parse into a bucket-relative path, or a check that errors (network hiccup), does **not** block scheduling — fail open, same conservative posture as `storage-sweep`'s "when in doubt, keep."
- **Publish time** (`app/api/cron/route.ts`): immediately before calling `uploadToYouTube` / `publishToTikTok`, re-run the same existence check (the file can vanish in the days between scheduling and the due time — exactly what happened here). A confirmed-missing object is classified as a **permanent** failure — skip straight to `status: "failed"` without spending the 3-attempt retry budget — with a specific `last_error` (e.g. `"Video file no longer exists in storage — it was deleted or swept before publishing."`).
- Defense in depth: add `/could not fetch video from storage/i` to both `isPermanentFailure` and `isTikTokPermanentFailure` so even if the pre-check is bypassed or races a delete, the existing download-time error still short-circuits retries instead of burning all 3 attempts.

## Capabilities

### New Capabilities

- `video-existence-check`: A shared, storage-API-backed existence check for `videos/` objects, invoked at both schedule-create time and immediately before each publish attempt, with the missing-file case treated as a permanent (non-retrying) publish failure.

### Modified Capabilities

- _(none — existing upload, scheduling, and publish flows are otherwise unchanged; this only adds a pre-flight check and a stricter failure classification.)_

## Impact

- **Backend:** `lib/storage-buckets.ts` gains `storagePathFromPublicUrl` (moved from `app/api/cron/route.ts`) and a new `videoObjectExists(path)` helper. `app/api/posts/route.ts` gains a pre-insert existence check. `app/api/cron/route.ts` gains a pre-publish existence check plus classifier updates.
- **Behavior:** scheduling a post whose video is already gone now fails immediately at creation with a clear error, instead of silently succeeding and failing 13 days later at publish time. A video that vanishes after scheduling now fails the post on the **first** publish attempt instead of after 3 retries.
- **Out of scope (deferred):** auditing *why* files disappear (e.g. verifying `storage-sweep`'s reference-matching correctness, or setting `CRON_SECRET` so `/api/cron/storage-sweep` isn't publicly triggerable) — tracked separately, not fixed by this change. No scheduler frontend UI changes beyond surfacing the new 422 error message.
- **Risk:** the existence check adds one extra Storage API call per schedule-create and per publish attempt — negligible latency, and it fails open on error so it can never itself block a legitimate publish.
