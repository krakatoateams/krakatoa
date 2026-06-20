## Why

Once a post is scheduled, it's effectively frozen in the UI. The calendar detail modal is read-only (title, description, tags, "View source video") and there's no way to fix a typo, tweak a caption, change the date/time, or cancel a post before it publishes. For a scheduling tool this is a basic expectation — the user explicitly flagged "edit post" as the top missing feature. The backing API already supports part of it: `PATCH /api/posts/[id]` updates `scheduled_time`/`status` with an ownership check, but not the content fields, and there's no delete.

## What Changes

- **Edit content + timing of a scheduled post**: title, description (caption), tags, scheduled date/time, and format. Editable only while the post is `scheduled` or `failed` (never once `published`).
- **Cancel / delete a scheduled post** (so a mistake can be removed, not just retried).
- **Extend `PATCH /api/posts/[id]`** to accept `title`, `description`, `tags`, `format` (validated like `POST /api/posts`), in addition to the existing `scheduled_time`/`status`, with a guard that blocks edits to `published` posts **and to posts currently being published** (the `publish_started_at` claim-lock added in `scheduler-cron-reliability`).
- **Fix the degraded Retry**: re-arming a post to `scheduled` (Retry button or saving an edited `failed` post) must reset `publish_attempts = 0` and clear `last_error`, otherwise the new bounded-retry cron immediately gives up again.
- **Soft-cancel via `canceled` status** (ownership-checked; blocked for `published`/`publishing`), wired into the `STATUS_CFG` / `derivePostDisplayStatus` display layer so canceled posts show muted.
- **UI**: turn the calendar detail modal (and/or the scheduler recent-posts list) into an editable form with Save / Cancel-post actions, with Edit/Cancel hidden for `published`/`publishing` posts.

## Capabilities

### New Capabilities

- `edit-scheduled-post`: Edit and cancel/delete a scheduled (or failed) post before it publishes.

## Impact

- **Backend:** `app/api/posts/[id]/route.ts` — broaden `PATCH` fields + status guard; add `DELETE` (or `canceled` status).
- **Frontend:** `app/(app)/tools/scheduler/calendar/page.tsx` (detail modal → edit form) and possibly the scheduler recent-posts list.
- **Dependencies:** pairs naturally with `scheduler-cron-publish` (editing an *overdue* post, re-arming a *failed* one). Independent enough to ship separately.
- **Risk:** editing a post the cron is mid-publishing could race. Mitigated by the status guard (only `scheduled`/`failed` editable) and small blast radius; a `publishing` lock from `scheduler-cron-publish` would harden it further.
