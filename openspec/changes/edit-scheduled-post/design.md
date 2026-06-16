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

### 2. Editability guard by status
Reject content edits when the post is `published` (return 409). Allow when `scheduled` or `failed`. This is the key safety rule and also prevents editing something already on YouTube.

### 3. Cancel = DELETE row (hard) vs `canceled` status (soft)
Default: **soft-cancel** by setting `status = "canceled"` — keeps history/audit and removes it from the cron's `scheduled` query naturally. Provide a true `DELETE` only if the user wants it gone entirely. (Pick during apply; soft is the safer default and matches the repo's soft-delete leanings elsewhere.)

### 4. UI: modal becomes an inline edit form
The calendar detail modal gains an "Edit" affordance that swaps the read-only fields for inputs (reusing the scheduler's field components where practical), with Save (PATCH) and Cancel-post (DELETE/canceled) actions, gated on status. The scheduler's recent-posts list can link into the same edit.

## Risks / Trade-offs

- **Race with the publisher**: a post could be edited while the cron is uploading it. The status guard limits exposure; a future `publishing` lock (from `scheduler-cron-publish`) closes the gap. Low likelihood at current cadence.
- **Soft-cancel leaves rows**: minor storage; acceptable and useful for history. A periodic purge could be added later.

## Alternatives Considered

- **Separate `PUT` replace endpoint** — heavier; partial PATCH is enough.
- **Allow editing published posts via the YouTube API** (update title/desc on YouTube) — valuable but a much bigger scope (needs `youtube` write scope + update calls); deferred.
