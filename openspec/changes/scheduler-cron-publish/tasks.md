# Tasks

## 1. Frequent trigger (decide mechanism first)
- [x] 1.1 Confirm trigger mechanism: GitHub Actions (default) / cron-job.org / Vercel Pro
- [x] 1.2 If GitHub Actions: add `.github/workflows/publish-cron.yml` on `*/5 * * * *` that curls `GET ${PROD_URL}/api/cron` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`
- [ ] 1.3 Add the required repo/Action secrets (`CRON_SECRET`, `CRON_TARGET_URL`) and document them — MANUAL (GitHub repo → Settings → Secrets → Actions)

## 2. Hobby-safe publisher
- [x] 2.1 `app/api/cron/route.ts`: cap due-posts processed per run (start N=3, ordered by `scheduled_time`)
- [x] 2.2 `app/api/cron/route.ts`: add `export const maxDuration = 60`
- [x] 2.3 Confirm failure path still marks `failed` and is retried on the next tick

## 3. Safety: no double-post + failure reason (folded in)
- [x] 3.1 Migration 013: add `posts.last_error text` and `posts.publish_started_at timestamptz`
- [x] 3.2 Claim-lock each post before upload: conditional update on `status='scheduled'` AND (`publish_started_at` is null OR older than the stale window); skip if no row claimed
- [x] 3.3 Idempotency: if a claimed post already has `youtube_video_id`, mark it `published` and skip re-upload
- [x] 3.4 On success clear `last_error`/`publish_started_at`; on failure store `last_error` and reset `publish_started_at`

## 4. Overdue / processing status UX
- [x] 4.1 Add a derived display-state helper (published/failed/publishing/overdue/scheduled/draft)
- [x] 4.2 Render it in the scheduler recent-posts list + show the failure reason on failed posts
- [x] 4.3 Render it in the calendar view + post detail modal (incl. failure reason)

## 5. Verification
- [x] 5.1 `tsc` + lint clean
- [ ] 5.2 Manual: schedule a post for ~2 min out → confirm it auto-publishes within a cadence window
- [ ] 5.3 Manual: confirm an overdue (pre-trigger) post shows "overdue/processing", not "failed"
- [ ] 5.4 Manual: force a failure (e.g. revoked token) → confirm it lands `failed`, shows the reason, retries next tick
