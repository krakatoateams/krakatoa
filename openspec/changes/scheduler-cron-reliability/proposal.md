## Why

`scheduler-cron-publish` made automated publishing *work*, but real-world testing surfaced reliability gaps:

1. **Trigger was imprecise.** GitHub Actions scheduled runs are best-effort and often delayed 5–20 min, so a "5:00 PM" post could sit "Overdue" well past its time.
2. **Batch size vs timeout risk.** `N=3` posts per run, each a full download+upload inside a 60s function, can time out mid-batch on larger videos — the one window where the claim-lock can still produce a duplicate.
3. **Failures were terminal.** A transient error (brief network blip) marked a post `failed` immediately, requiring a manual retry, even though it would likely succeed on the next tick.

## What Changes

- **Switch the primary trigger to cron-job.org every 1 minute** (precise, free), keeping the GitHub Actions workflow as a **backup at a slower `*/15` cadence**. The claim-lock makes running both pingers concurrently safe.
- **Lower the per-run batch to `N=1`.** YouTube's own quota caps practical throughput at ~6 uploads/day, so high throughput is never needed; `N=1` makes each run finish fast, nearly eliminating timeout/duplicate risk at zero practical cost.
- **Add bounded auto-retry for transient failures** (max 3 attempts) while **giving up immediately on permanent errors** (auth/token or quota), so the system self-heals brief blips without wasting YouTube quota on errors that won't fix themselves.
- **Rotate `CRON_SECRET`** to a fresh value, since it will now also live in a third-party dashboard (cron-job.org).

Out of scope (deferred): requesting a YouTube API quota increase. Default ~6 uploads/day is acceptable for current single-team usage.

## Capabilities

### Modified Capabilities

- `scheduler-cron-publish`: tighter trigger cadence, single-post batches, and resilient retry behavior.

## Impact

- **Backend:** `app/api/cron/route.ts` — `N=1`, error classification, bounded retry.
- **DB:** new migration adding `posts.publish_attempts`.
- **CI/infra:** `.github/workflows/publish-cron.yml` cadence `*/5 → */15` (backup role).
- **Config (manual):** rotate `CRON_SECRET` across Vercel, GitHub, `.env.local`; set up cron-job.org job.
- **Risk:** secret now stored in a third-party dashboard (low blast radius — it only gates an idempotent trigger). Residual duplicate risk shrinks further with `N=1`.
