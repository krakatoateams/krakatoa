## Why

Once a post is scheduled, it's effectively frozen in the UI. The calendar detail modal is read-only (title, description, tags, "View source video") and there's no way to fix a typo, tweak a caption, change the date/time, or cancel a post before it publishes. For a scheduling tool this is a basic expectation — the user explicitly flagged "edit post" as the top missing feature. The backing API already supports part of it: `PATCH /api/posts/[id]` updates `scheduled_time`/`status` with an ownership check, but not the content fields, and there's no delete.

## What Changes

- **Edit content + timing of a scheduled post**: title, description (caption), tags, scheduled date/time, and format. Editable only while the post is `scheduled` or `failed` (never once `published`).
- **Cancel / delete a scheduled post** (so a mistake can be removed, not just retried).
- **Extend `PATCH /api/posts/[id]`** to accept `title`, `description`, `tags`, `format` (validated like `POST /api/posts`), in addition to the existing `scheduled_time`/`status`, with a guard that blocks edits to `published` posts.
- **Add `DELETE /api/posts/[id]`** (ownership-checked; blocked for `published` posts, or soft-cancel via a `canceled` status — see design).
- **UI**: turn the calendar detail modal (and/or the scheduler recent-posts list) into an editable form with Save / Cancel-post actions.

## Capabilities

### New Capabilities

- `edit-scheduled-post`: Edit and cancel/delete a scheduled (or failed) post before it publishes.

## Impact

- **Backend:** `app/api/posts/[id]/route.ts` — broaden `PATCH` fields + status guard; add `DELETE` (or `canceled` status).
- **Frontend:** `app/(app)/tools/scheduler/calendar/page.tsx` (detail modal → edit form) and possibly the scheduler recent-posts list.
- **Dependencies:** pairs naturally with `scheduler-cron-publish` (editing an *overdue* post, re-arming a *failed* one). Independent enough to ship separately.
- **Risk:** editing a post the cron is mid-publishing could race. Mitigated by the status guard (only `scheduled`/`failed` editable) and small blast radius; a `publishing` lock from `scheduler-cron-publish` would harden it further.
