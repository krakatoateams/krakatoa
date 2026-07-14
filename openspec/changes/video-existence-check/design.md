## Context

`posts.video_url` (and the `user_creations`/asset rows it's copied from) is a plain public-URL string with no foreign-key/consistency guarantee against the actual Supabase Storage object. Nothing in the request path re-validates that the object is still there between "scheduled" and "published" — a gap that can span minutes (immediate test) or, as observed, 13 days.

Confirmed root cause of the 2026-07-13 incident (read-only investigation, no code changed):
```
posts.video_url → videos/video_1782820848577.mp4 (generated 2026-06-30 via api/generate-video)
                → object no longer in bucket
                → GET on the public URL returns {"statusCode":"404","error":"not_found"}
                → Supabase's storage gateway reports that as HTTP 400
                → lib/youtube.ts:60-65 / lib/tiktok.ts:273-276 throw
                  "Could not fetch video from storage (HTTP 400): ..."
                → app/api/cron/route.ts's isPermanentFailure/isTikTokPermanentFailure
                  don't recognize this message → treated as transient
                → retried 3x (MAX_PUBLISH_ATTEMPTS), same result every time
                → status: "failed"
```
Only this one object was affected (checked every other `failed` post — all other failures are unrelated `invalid_grant` OAuth errors), and `storage-sweep`'s current reference-matching logic would not have flagged this specific file as an orphan today (it's still referenced in `user_creations`, table is well under any pagination limit). How the object actually disappeared (manual cleanup vs. an earlier sweep run) could not be determined from application data alone — out of scope here; see proposal's "Out of scope."

## Goals / Non-Goals

**Goals:**
- Catch an already-missing video at schedule time, not 13 days later at publish time.
- Catch a video that vanishes *after* scheduling on the first publish attempt, not after burning the full retry budget.
- Keep the check cheap, and fail open on any check-itself error or unparseable URL (never let the safety check become a new way to block a legitimate publish).

**Non-Goals:**
- Explaining or fixing why the object disappeared in the first place (separate investigation/change).
- Locking `posts.video_url` to a real DB foreign key against storage — storage objects aren't rows; a lightweight existence probe is enough.
- Any scheduler frontend redesign — just surfacing the new error message through the existing error-display path.

## Decisions

### 1. Check via Storage API `list()`, not a CDN `fetch()` of the public URL
`lib/storage-sweep.ts` already lists objects via `supabaseServer.storage.from(bucket).list(prefix, { search })` for the exact same reason: the public object URL is served through a CDN layer, so a `HEAD`/`GET` against it can return a stale cached `200` for an object that was deleted moments ago (or, in the account's favor, a stale `400` shortly after upload before cache invalidation). Hitting the Storage API's `list()` endpoint asks Supabase's metadata store directly — the same source of truth `storage-sweep` already trusts. New helper:

```ts
// lib/storage-buckets.ts (pure — safe for client bundles)
export function storagePathFromPublicUrl(url: string | null | undefined): string | null { ... }

// lib/video-storage.ts (server-only — imports lib/supabase-server)
export async function videoObjectExists(path: string): Promise<boolean | null> {
  // null = "couldn't determine" (treat as fail-open by caller)
}
export async function isVideoUrlConfirmedMissing(url: string | null | undefined): Promise<boolean> { ... }
```
`storagePathFromPublicUrl` is moved into `storage-buckets.ts` verbatim from `app/api/cron/route.ts` (currently a private helper there) so both the new pre-checks and the existing `cleanupPostVideo` share one implementation instead of two copies drifting apart.

**Split across two files, not one — learned the hard way.** The first pass put `videoObjectExists`/`isVideoUrlConfirmedMissing` directly in `storage-buckets.ts` alongside a module-level `import { supabaseServer } from "@/lib/supabase-server"`. `storage-buckets.ts` turns out to be imported by client components too (`app/(app)/dashboard` → `RecentCreations` → `CreationsHistory` → `lib/creation-model-label.ts` → `lib/product-photo.ts` → `storage-buckets.ts`, just for the `PHOTOS_FOLDER`/`STORAGE_BUCKET` constants). `supabase-server.ts` constructs its client at module scope with `SUPABASE_SERVICE_ROLE_KEY`, a secret that doesn't exist in the browser — so the import rode along into the client bundle and threw `supabaseKey is required` on every page reachable through that chain (reproduced live: blank white screen on `/dashboard`). Fix: keep `storage-buckets.ts` 100% pure (constants + string helpers, zero imports), and put every function that touches `supabaseServer` in the new `lib/video-storage.ts`, which only `app/api/posts/route.ts` and `app/api/cron/route.ts` (Route Handlers, categorically server-only) import.

### 2. Fail open on ambiguity, fail closed only on a confirmed absence
Mirrors `storage-sweep`'s own philosophy ("when in doubt, keep"). `videoObjectExists` returns:
- `true` — object confirmed present.
- `false` — object confirmed absent (the `list()` call succeeded and found no matching entry).
- `null` — couldn't determine (Storage API error, or the URL didn't parse to a path in our bucket, e.g. a legacy/external URL). Callers treat `null` the same as `true` (don't block).

Only an explicit `false` triggers the new behavior (422 at schedule time, permanent-failure at publish time).

### 3. Schedule-time check lives in `app/api/posts/route.ts`, after URL resolution
The check runs once `resolvedVideoUrl` is final (manual `video_url` or asset-derived `assetPublicUrl`), right before the `insertRow` is built — so it covers both entry points (raw upload and "pick from library") with one check. A `false` result returns `422` with a message the scheduler UI already has a path to display (same pattern as the existing `409 Asset is not ready` / `422 Asset has no public URL` responses just above it in the same route).

### 4. Publish-time check lives in `app/api/cron/route.ts`, right before the platform call
Placed after the claim-lock and token lookup (so we don't re-check on a post another run already claimed) but before `uploadToYouTube`/`publishToTikTok`. A `false` result is raised as a distinguishable error (e.g. throwing a plain `Error("Video file no longer exists in storage — it was deleted or swept before publishing.")`) that flows into the existing `catch` block. That block's `permanent` classification is extended (Decision 5) to recognize this message, so it skips straight to `status: "failed"` on the **first** attempt rather than spending the 3-attempt budget.

### 5. Classifier update: missing-storage-file is permanent, in both classifiers
Add to `isPermanentFailure` and `isTikTokPermanentFailure`:
```ts
if (/video file no longer exists in storage|could not fetch video from storage/i.test(m)) return true;
```
The second half of that pattern (`could not fetch video from storage`) is the existing message from `lib/youtube.ts`/`lib/tiktok.ts` — added as defense in depth so that even if the new pre-check is skipped (URL unparseable → `null` → fail open) or races an in-flight delete, the fallback download-time failure still doesn't retry 3x for nothing.

### 6. `youtube.ts` / `tiktok.ts` fetch-based errors are left as-is
They remain the last-resort runtime guard (the pre-check and the actual download are not atomic — a delete could land in between). No behavior change there beyond what Decision 5 already covers by pattern-matching their existing message.

## Risks / Trade-offs

- **Extra Storage API call per schedule + per publish attempt** — negligible cost/latency; `storage-sweep` already does the equivalent at bucket scale daily.
- **`null` (undeterminable) always fails open** — a persistent Storage API outage would mean this check silently does nothing, same net behavior as today (acceptable; we never want the safety net itself to block valid publishes).
- **Race window between check and download still exists** — mitigated by Decision 5's message-pattern fallback, not eliminated; acceptable since the check reduces the window from "up to days" to "the duration of one request."

## Alternatives Considered

### Store a storage-verified checksum/etag on the post row for stronger drift detection
Rejected as unnecessary complexity — a simple existence check answers the actual failure mode observed (object gone), and an etag mismatch (object present but corrupted) hasn't been observed and would still surface at download time either way.

### Poll/verify continuously via a background job instead of at schedule + publish time
Rejected — adds a new scheduled job for a problem that only needs checking at the two moments that matter (when the user commits to scheduling, and immediately before spending a publish attempt).
