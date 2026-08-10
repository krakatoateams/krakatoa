## Context

The task that spawned this change assumed TikTok posts are still marked "published" optimistically, immediately after Init, with no real status check — "the same class of bug already fixed for photo posts' domain-verification issue, but broader." **Direct code investigation shows this premise is out of date.** `app/api/cron/route.ts`'s TikTok branch already calls `waitForTikTokPublishOutcome(refreshed.accessToken, publishId)` (`lib/tiktok.ts`) immediately after Init, for **both** the video and photo publish paths — the call is not inside the `isPhotoPost` conditional, it runs for the whole TikTok branch unconditionally. This already:
- Polls `POST /v2/post/publish/status/fetch/` on a bounded interval (3s, up to 24s — comfortably inside the cron's `maxDuration = 60`).
- Marks the post `failed` with TikTok's real `fail_reason` on a genuine `FAILED` status, instead of trusting Init's success.
- Leaves the post `scheduled` (re-checking, not re-publishing) if TikTok is still processing past the wait budget (`"pending"` outcome).
- Only marks `published` on a confirmed `PUBLISH_COMPLETE`.

This shipped as part of `tiktok-photo-post`'s bug-history fix (a photo post sat as "published" while TikTok's real status was `FAILED` with `file_format_check_failed`) but was never scoped to photos only — it's the same call, same code path, for every TikTok post. **So there is no new verification work to design or build here.** This design covers only the genuinely new part: capturing a real share URL now that the app can publish public (non-SELF_ONLY) content.

**TikTok's status-fetch response** (`POST /v2/post/publish/status/fetch/`, per TikTok's own reference docs):
```json
{
  "data": {
    "status": "string",
    "fail_reason": "string",
    "publicaly_available_post_id": "list<int64>",
    "uploaded_bytes": "int64",
    "downloaded_bytes": "int64"
  },
  "error": { "code": "string", "message": "string", "log_id": "string" }
}
```
- `publicaly_available_post_id` (TikTok's own spelling — not "publicly") is documented as "returned only if the post is published for public viewership and has been approved by the TikTok moderation process." A `SELF_ONLY` post — every post this app has ever published, pre-App-Review — never populates this field.
- No `share_url` field exists directly; the real permalink must be constructed as `https://www.tiktok.com/@{username}/video/{publicaly_available_post_id[0]}`. The username is already available via `getCreatorInfo` (`lib/tiktok.ts`), which the cron's TikTok branch already calls once per publish attempt (inside `publishToTikTok`/`publishPhotoToTikTok`) — though not in the idempotent-resume branch (see Decision 3).
- The docs show no schema difference between photo and video posts for this endpoint — confirmed by the existing code already treating both uniformly.

## Goals / Non-Goals

**Goals:**
- Capture a real, storable TikTok share URL once a post is confirmed `PUBLISH_COMPLETE` with a public post ID.
- Add a "View on TikTok" button to the Calendar, matching YouTube's existing pattern, shown only when a real share URL exists.
- Do this without duplicating or destabilizing the status-verification logic that already exists and already works.

**Non-Goals:**
- Rebuilding or "fixing" `waitForTikTokPublishOutcome` — it already does what the task asked for; see Context.
- Any change to `privacy_level` selection/defaulting (Decision 4 — already correct).
- A share-URL equivalent for `SELF_ONLY` posts — none exists; TikTok gives nothing to link to.
- Live end-to-end testing — not possible right now (Supabase egress-restricted, separate active incident; see `proposal.md` Impact).

## Decisions

### 1. Extend the existing outcome type rather than add a parallel mechanism
`TikTokPublishOutcome`'s `"complete"` variant gains a `publicPostId: string | null` field, populated by the same `fetchPublishStatus` call that already runs. No second API call, no second polling loop — the post ID is already present in the exact response `waitForTikTokPublishOutcome` was already reading, it just wasn't being extracted.

### 2. Parse the public post ID from raw response text, not the already-JSON.parse'd object
TikTok's docs type `publicaly_available_post_id` as `list<int64>`. Real TikTok post IDs are ~19-digit snowflake-style numbers that exceed `Number.MAX_SAFE_INTEGER` (2^53 − 1). If TikTok ever serializes this as a bare (unquoted) JSON number rather than a quoted string, `JSON.parse` would silently round it to the nearest representable double **before** any of our code could see the true value — there is no way to recover the exact digits after that point. `extractFirstPublicPostId` instead regexes the raw response text (`res.text()`, not `res.json()`) for the first entry's digit run, working correctly whether TikTok sends it quoted or bare. **This has not been observed against a real response** (no live test was possible during this change) — flagged in Risks and `tasks.md` as the first thing to verify once testing is possible again, ideally by logging the raw response body from one real public-post status check.

### 3. Username lookup is best-effort and lazy, only when a public post ID exists
Building the share URL needs the creator's username (`getCreatorInfo`). The cron's TikTok branch already calls this once per publish attempt inside `publishToTikTok`/`publishPhotoToTikTok` — but the idempotent-resume path (`claimed.tiktok_publish_id` already set from a prior tick) skips straight to re-polling status and never calls those functions, so that username isn't already in hand. Rather than plumbing it through every code path (including the resume branch) or persisting it speculatively, the cron route calls `getCreatorInfo(refreshed.accessToken)` a second time — but **only** once `outcome.publicPostId` is non-null, i.e. only exactly when a share URL is actually about to be built, wrapped in its own try/catch so a failure here can never turn an already-confirmed publish into a failed post (mirrors the existing best-effort pattern already used for TikTok connect-time validation in `connect-tiktok`).

### 4. `privacy_level` — already dynamic, no code change
Investigated per the task's request: `app/api/connections/tiktok/creator-info/route.ts` already fetches `privacy_level_options` live from TikTok's Creator Info endpoint on every request, and the scheduler UI (`app/(app)/tools/scheduler/page.tsx`) already renders whatever options come back as a required dropdown (`tiktokPrivacyLevel: null` initial state, never silently defaulted — `tiktok-publish` Decision 4, already shipped). Sandbox/unaudited apps are restricted by TikTok itself to `SELF_ONLY` regardless of what the app requests, which is *why* only `SELF_ONLY` has ever been observed in this dropdown — not because the code hardcodes it. Once TikTok's own Creator Info response starts returning broader options for this now-approved app, the existing dropdown will show them with zero code change. **This needs operational confirmation, not implementation**: has Creator Info actually started returning non-`SELF_ONLY` options for the connected account yet? That's the only thing to verify — flagged in `tasks.md`, not assumed here.

### 5. New `posts.tiktok_share_url` column, additive
Mirrors `youtube_video_id`/`tiktok_publish_id`'s existing pattern exactly: nullable, `add column if not exists`, no CHECK constraint (validated in application code only, matching this repo's established convention). `GET /api/posts` already `select("*")`s, so the Calendar UI receives the new field with zero API changes beyond the TypeScript interface.

## Risks / Trade-offs

- **Decision 2's raw-text parsing has not been verified against a real TikTok response** — the regex is written defensively based on the documented schema shape, but if TikTok's actual response format differs subtly (e.g., a different key ordering or whitespace pattern the regex doesn't anticipate), it could silently fail to extract an ID that's actually present. Low blast radius: worst case, `publicPostId` stays `null` and no share URL is built (the post still correctly publishes and is marked `published` either way) — it fails safe, not silently wrong.
- **Username lookup is a second live API call** on the (likely rare, one-time-per-post) success path — acceptable given it only fires once, only on confirmed public completion, and is fully best-effort.
- **No live test was possible during this change** (Supabase egress-restricted; also no way to trigger a real public TikTok publish from this environment) — everything here is designed and code-reviewed, not empirically confirmed. `tasks.md` calls out exactly what to check first once testing is possible again.

## Alternatives Considered

- **Storing the raw `publicaly_available_post_id` and constructing the share URL client-side in the Calendar** — rejected: would require also fetching/storing the creator's username somewhere the client can read it, for no real benefit over building the final URL once, server-side, at the moment it's known.
- **Re-deriving verification logic from scratch, per the task's original framing** — rejected outright once Context's investigation showed the polling already exists and already works; rebuilding it would risk regressing a mechanism that's been in production since `tiktok-photo-post`.
- **Hardcoding a broader `privacy_level` default now that the app is "in production"** — rejected per Decision 4: the existing dynamic-dropdown design was already built anticipating exactly this transition; hardcoding anything would be a regression against a deliberate prior decision, not an improvement.
