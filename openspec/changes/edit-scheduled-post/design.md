## Context

`PATCH /api/posts/[id]` exists: it authenticates, verifies ownership (`posts.user_id` == session user), and updates `scheduled_time` and/or `status`. There is no `DELETE`. The calendar detail modal (`app/(app)/tools/scheduler/calendar/page.tsx`) renders a post read-only. `POST /api/posts` already validates `format` (`'short'|'video'`) and stores title/description/tags — the same validation should be reused on edit.

## Goals / Non-Goals

**Goals:**
- Edit title, caption (description), tags, date/time, and format of a not-yet-published post.
- Cancel/remove a scheduled or failed post.
- Reuse existing auth/ownership + format validation.

**Non-Goals:**
- No editing of `published` posts (YouTube already has the video; out of scope here).
- No editing the underlying video file/URL (re-schedule a new post for that).
- No bulk edit.

## Decisions

### 1. Extend PATCH, don't add a new route
Add `title`, `description`, `tags`, `format` to the `PATCH /api/posts/[id]` body. Validate `format` identically to `POST` (accept `short`/`video`, else ignore). Build the `updates` object from whichever fields are present (partial update). Keeps one mutation surface.

### 2. Editability guard by status (+ live "publishing" lock)
Reject content edits when the post is `published` (return 409). Allow when `scheduled` or `failed`. This is the key safety rule and also prevents editing something already on YouTube.

**Update (post `scheduler-cron-reliability`):** the "publishing lock" that this design previously called future work now exists — the cron claims a post by stamping `publish_started_at`. So the guard is tightened: also reject edits/cancel when the post is currently being published, i.e. `publish_started_at` is set and still fresh (within `CLAIM_STALE_MS` = 10 min). Reuse the same staleness window as `lib/post-status.ts`'s `derivePostDisplayStatus` so "Publishing" in the UI and "locked from edit" in the API agree. Concretely: editable ⟺ status ∈ {scheduled, failed} AND not currently publishing.

### 3. Re-arm on edit/retry MUST reset the retry counter
`scheduler-cron-reliability` added `publish_attempts` (give up after 3) and `last_error`. The existing Retry button — and editing a `failed` post — only flips `status → scheduled`, leaving `publish_attempts` at its failed value (e.g. 3). With the new bounded-retry the cron would then immediately give up again, making Retry a no-op. **Fix centrally in `PATCH`:** whenever the request sets `status = "scheduled"` (Retry, or saving an edited `failed` post), also reset `publish_attempts = 0` and `last_error = null`. This covers the Retry button and the "edit failed post" flow in one place. Saving an edited `failed` post SHALL re-arm it to `scheduled` (decision B: yes).

### 4. Cancel = DELETE row (hard) vs `canceled` status (soft)
Default: **soft-cancel** by setting `status = "canceled"` — keeps history/audit and removes it from the cron's `scheduled` query naturally. Provide a true `DELETE` only if the user wants it gone entirely. (Pick during apply; soft is the safer default and matches the repo's soft-delete leanings elsewhere.)

Soft-cancel adds a 6th stored status, so it must be wired into the display layer built in `scheduler-cron-publish`: extend the `status` union in both calendar and scheduler `Post` types, add a `canceled` entry to each `STATUS_CFG` (label "Canceled", muted/gray styling), and let `derivePostDisplayStatus` pass it through. Canceled posts render muted in the list/calendar (not hidden) so the action is visible and reversible-by-context; the cron's `status = "scheduled"` filter already excludes them.

### 5. UI: modal becomes an inline edit form
The calendar detail modal gains an "Edit" affordance that swaps the read-only fields for inputs (reusing the scheduler's field components where practical), with Save (PATCH) and Cancel-post (soft `canceled`) actions, gated on status. Edit/Cancel controls are hidden when the post is `published` or currently `publishing`. The scheduler's recent-posts list can link into the same edit (optional this pass).

## Risks / Trade-offs

- **Race with the publisher**: closed (not just limited) by the live `publish_started_at` lock — the API refuses to edit/cancel a post the cron has claimed, matching the "Publishing" UI state. Residual window is only the sub-second between read and write, acceptable at current cadence.
- **Soft-cancel leaves rows**: minor storage; acceptable and useful for history. A periodic purge could be added later. The canceled post still references its `video_url`, so storage-hygiene won't sweep that video while the row exists.

## Alternatives Considered

- **Separate `PUT` replace endpoint** — heavier; partial PATCH is enough.
- **Allow editing published posts via the YouTube API** (update title/desc on YouTube) — valuable but a much bigger scope (needs `youtube` write scope + update calls); deferred.
