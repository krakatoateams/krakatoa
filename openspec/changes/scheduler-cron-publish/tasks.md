# Tasks

## 1. Frequent trigger (decide mechanism first)
- [ ] 1.1 Confirm trigger mechanism: GitHub Actions (default) / cron-job.org / Vercel Pro
- [ ] 1.2 If GitHub Actions: add `.github/workflows/publish-cron.yml` on `*/5 * * * *` that curls `GET ${PROD_URL}/api/cron` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`
- [ ] 1.3 Add the required repo/Action secrets (`CRON_SECRET`, prod URL) and document them

## 2. Hobby-safe publisher
- [ ] 2.1 `app/api/cron/route.ts`: cap due-posts processed per run (start N=3, ordered by `scheduled_time`)
- [ ] 2.2 `app/api/cron/route.ts`: add `export const maxDuration = 60`
- [ ] 2.3 Confirm failure path still marks `failed` and is retried on the next tick

## 3. Overdue status UX
- [ ] 3.1 Add a derived "overdue/processing" state helper (`status === "scheduled" && scheduled_time < now`)
- [ ] 3.2 Render it in the scheduler recent-posts list
- [ ] 3.3 Render it in the calendar view + post detail modal

## 4. Verification
- [ ] 4.1 Manual: schedule a post for ~2 min out → confirm it auto-publishes within a cadence window
- [ ] 4.2 Manual: confirm an overdue (pre-trigger) post shows "overdue/processing", not "failed"
- [ ] 4.3 Manual: force a failure (e.g. revoked token) → confirm it lands `failed` and retries next tick
