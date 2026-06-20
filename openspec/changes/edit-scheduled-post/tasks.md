# Tasks

## 1. API — extend mutation surface
- [x] 1.1 `PATCH /api/posts/[id]`: accept `title`, `description`, `tags`, `format` (validate `format` like POST — accept `short`/`video`, ignore others); build partial `updates`
- [x] 1.2 `PATCH`: reject content edits when status is `published` (409); allow `scheduled`/`failed`
- [x] 1.3 `PATCH`: reject edits/cancel when the post is currently publishing (`publish_started_at` set and within `CLAIM_STALE_MS`); reuse the staleness window from `lib/post-status.ts`
- [x] 1.4 `PATCH`: when `status` is set to `scheduled` (Retry or saving an edited `failed` post), also reset `publish_attempts = 0` and `last_error = null` (fixes the degraded-retry gap)
- [x] 1.5 Cancel: implement soft-cancel (`status = "canceled"`); guard against canceling `published`/`publishing`
- [x] 1.6 Confirm the cron due-query ignores `canceled` (already filters `status = "scheduled"`)

## 2. Status plumbing — `canceled`
- [x] 2.1 Add `canceled` to the `Post.status` unions and `STATUS_CFG` in `calendar/page.tsx` and `scheduler/page.tsx` (label "Canceled", muted/gray styling)
- [x] 2.2 `lib/post-status.ts`: pass `canceled` through `derivePostDisplayStatus`
- [x] 2.3 Canceled posts render muted (not hidden) in list + calendar

## 3. UI — editable detail
- [x] 3.1 Calendar detail modal: add Edit mode (inputs for title/caption/tags/date/time/format), Save → PATCH
- [x] 3.2 Add Cancel-post action (gated to `scheduled`/`failed`, hidden when `published`/`publishing`), with confirm
- [x] 3.3 Hide Edit/Cancel affordances when `published` or `publishing`
- [x] 3.4 Reflect edits/cancel without full reload (refetch posts)
- [ ] 3.5 (Optional) link edit from the scheduler recent-posts list — deferred; Retry there already benefits from the central reset fix

## 4. Verification
- [x] 4.1 `npx tsc --noEmit` + lint clean
- [ ] 4.2 Manual: edit a scheduled post's title/time → persists; cron uses new values
- [ ] 4.3 Manual: edit/retry a failed post → re-armed to scheduled with attempts reset; publishes on next run
- [ ] 4.4 Manual: cancel a scheduled post → shows "Canceled", no longer published
- [ ] 4.5 Manual: confirm a published post cannot be edited or canceled
- [ ] 4.6 Manual: confirm a post mid-publish (Publishing) cannot be edited or canceled
