# Tasks

## 1. Single-post batches
- [x] 1.1 `app/api/cron/route.ts`: `MAX_POSTS_PER_RUN` 3 → 1

## 2. Bounded auto-retry with error classification
- [x] 2.1 Migration 014: add `posts.publish_attempts integer not null default 0`
- [x] 2.2 `app/api/cron/route.ts`: add `isPermanentFailure(err, message)` helper (auth/token + quota → permanent)
- [x] 2.3 On failure: permanent OR attempts≥3 → `failed`; else → back to `scheduled` (retry next tick), increment attempts, release lock, store `last_error`
- [x] 2.4 On success (and idempotent already-uploaded path): reset `publish_attempts = 0` and clear `last_error`

## 3. Backup trigger cadence
- [x] 3.1 `.github/workflows/publish-cron.yml`: schedule `*/5` → `*/15` (now backup to cron-job.org)

## 4. Secret rotation (config)
- [x] 4.1 Generate a fresh `CRON_SECRET`; update `.env.local`
- [ ] 4.2 MANUAL: set new secret in GitHub Actions secret + cron-job.org, then flip Vercel env + redeploy (per design order)
- [ ] 4.3 MANUAL: create cron-job.org job → `GET /api/cron` every 1 min with `Authorization: Bearer <new>`

## 5. Verification
- [x] 5.1 `tsc` + lint clean
- [ ] 5.2 MANUAL: apply migration 014 in Supabase
- [ ] 5.3 MANUAL: schedule a post ~1–2 min out → confirm it publishes within ~1–2 min via cron-job.org
- [ ] 5.4 MANUAL: force a transient vs permanent failure → confirm retry vs immediate-fail behavior
