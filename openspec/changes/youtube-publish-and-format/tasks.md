# Tasks

## 1. Publish public
- [x] 1.1 In `lib/youtube.ts`, change `privacyStatus: "unlisted"` → `"public"` and update the comment

## 2. Persist format
- [x] 2.1 Add `supabase/migrations/012_posts_format.sql` — `alter table posts add column if not exists format text` (additive, idempotent), with a header comment documenting allowed values `'short' | 'video'`
- [x] 2.2 `POST /api/posts`: read `format` from the body, accept only `"short"`/`"video"`, add to `insertRow` when valid (else leave null)
- [x] 2.3 Scheduler single mode: include `format` in `ScheduleCard.handleSubmit` POST body
- [x] 2.4 Scheduler bulk mode: include `format` in `handleScheduleAll` POST body

## 3. Verification
- [x] 3.1 `npx tsc --noEmit` passes
- [x] 3.2 Lint clean on edited files
- [ ] 3.3 Manual (post-deploy): run the DB migration; schedule one real post; confirm it lands **Public** on YouTube and the post row has the expected `format`
