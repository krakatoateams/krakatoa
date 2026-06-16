# Tasks

## 1. API — extend mutation surface
- [ ] 1.1 `PATCH /api/posts/[id]`: accept `title`, `description`, `tags`, `format` (validate `format` like POST); build partial `updates`
- [ ] 1.2 `PATCH`: reject content edits when status is `published` (409); allow `scheduled`/`failed`
- [ ] 1.3 Cancel: implement soft-cancel (`status = "canceled"`) — decide hard `DELETE` vs soft during apply
- [ ] 1.4 Ensure the cron's due-query ignores `canceled` (it already filters `status = "scheduled"`, so confirm)

## 2. UI — editable detail
- [ ] 2.1 Calendar detail modal: add Edit mode (inputs for title/caption/tags/date/time/format), Save → PATCH
- [ ] 2.2 Add Cancel-post action (gated to `scheduled`/`failed`), with confirm
- [ ] 2.3 Reflect edits/cancel without full reload (refetch posts)
- [ ] 2.4 (Optional) link edit from the scheduler recent-posts list

## 3. Verification
- [ ] 3.1 `npx tsc --noEmit` + lint clean
- [ ] 3.2 Manual: edit a scheduled post's title/time → persists; cron uses new values
- [ ] 3.3 Manual: cancel a scheduled post → no longer published
- [ ] 3.4 Manual: confirm a published post cannot be edited or canceled
