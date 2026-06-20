# Design

## Trigger topology

```
  cron-job.org (every 1 min, PRIMARY)  ─┐
                                         ├─ Bearer CRON_SECRET ─▶ GET /api/cron
  GitHub Actions (every 15 min, BACKUP) ─┘
```

Both pingers hit the same endpoint. The existing claim-lock (`publish_started_at` conditional update) + `youtube_video_id` idempotency guard make concurrent/overlapping runs safe — no double upload. The backup exists so a cron-job.org outage doesn't fully halt publishing.

## Batch size: N=1

YouTube `videos.insert` costs 1600 quota units; the default project quota is 10,000/day ≈ **6 uploads/day**. That ceiling — not our cron — bounds throughput. So there is no need to process multiple posts per run.

`N=1` means each invocation does at most one download+upload, finishing well within `maxDuration = 60`. This shrinks the timeout window that is the only remaining source of duplicate uploads. With a 1-minute cadence, any realistic backlog still drains quickly (1 post/min ≫ 6/day).

## Retry policy

New column `posts.publish_attempts` (int, default 0) counts attempts.

On a failed upload, classify the error:

```
  PERMANENT (don't retry — won't self-heal, may waste quota):
    • auth/token problems  (401, "re-authorise", "refresh token", missing token row)
    • quota                (403, "quotaExceeded", "dailyLimitExceeded")
        → status = "failed", store last_error, release lock

  TRANSIENT (retry):
    • everything else (network blips, 5xx, fetch errors)
        → attempts += 1
        → if attempts >= 3 : status = "failed" (gave up), store last_error
        → else             : status = "scheduled" (retry next tick),
                              release lock, store last_error, keep attempts
```

On success: `status = "published"`, `youtube_video_id` set, `last_error = null`, `publish_started_at = null`, `publish_attempts = 0`.

A transient-retry post returns to `scheduled` with the lock released, so the next tick (~1 min later) re-claims and retries it. Because it's past due, it reads as "Overdue" in between — accurate.

### Note on the timeout edge
If a run dies *before* writing the retry/increment (e.g. a true 60s timeout), `publish_attempts` isn't incremented and the stale-lock (10 min) path eventually re-claims it. `N=1` makes this very unlikely; we accept the small residual.

## Secret rotation order (no lockout)

The endpoint authorizes against Vercel's `CRON_SECRET`. To avoid a window where the live trigger is rejected:

```
  1. Set NEW secret in both pingers first (GitHub secret, cron-job.org header)
  2. Flip Vercel env CRON_SECRET = NEW  → redeploy   (everything aligns)
  3. Update .env.local = NEW (local dev parity)
```

A brief 401 gap before step 2 is harmless (nothing publishes; next tick covers it).
