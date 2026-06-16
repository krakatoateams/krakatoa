## Why

The scheduler's core promise — "publish on autopilot at the scheduled time" — does not actually run in production. Two compounding problems:

1. **The publisher cron is not triggered.** `vercel.json` only registers `/api/cron/storage-sweep` (daily); the actual publisher `/api/cron` is missing. So no due posts are ever processed automatically — they sit at `status = "scheduled"` forever (never published, never failed). Earlier successful uploads were manual hits of the endpoint.

2. **Vercel Hobby can't do real scheduling anyway.** Hobby cron jobs run **once per day** (max 2 jobs). Even if we registered `/api/cron` natively, a "6:00 PM" post would only be picked up at the single daily tick — up to ~24h late.

Separately, this exposes a UX gap: a post whose `scheduled_time` has passed but hasn't been processed yet still shows **"Scheduled"**, which looks stuck. (It has not *failed* — "failed" should mean an attempted upload was rejected — it's simply **overdue/awaiting the queue**.)

## What Changes

- **Trigger `/api/cron` frequently via a free external pinger** (recommended: a committed GitHub Actions scheduled workflow; alternative: cron-job.org) that calls `GET /api/cron` with `Authorization: Bearer ${CRON_SECRET}` every ~5 minutes. This bypasses the Hobby once-per-day limit. (Alternative path: Vercel Pro for native per-minute cron.)
- **Make `/api/cron` Hobby-safe**: process a bounded number of due posts per run (e.g. 1–3) and set an explicit `maxDuration` within the Hobby cap, so a backlog drains across successive pings instead of timing out mid-upload.
- **Add an "overdue / processing" derived state** in the UI for posts where `status = "scheduled"` and `scheduled_time < now`, so they read as "waiting to publish" rather than looking stuck — without mislabeling them "failed".
- Keep `/api/cron/storage-sweep` on its existing daily Vercel cron (daily is fine for cleanup).

## Capabilities

### New Capabilities

- `scheduler-cron-publish`: Reliable automated publishing of due posts on Vercel Hobby, plus honest scheduled/overdue/published/failed status in the UI.

## Impact

- **CI/infra:** new `.github/workflows/publish-cron.yml` (or external cron config) — the frequent trigger.
- **Backend:** `app/api/cron/route.ts` — bounded per-run batch + `maxDuration`.
- **Frontend:** scheduler recent-posts list + `app/(app)/tools/scheduler/calendar/page.tsx` — derived "overdue/processing" badge.
- **Open decision:** trigger mechanism — GitHub Actions (free, in-repo) vs cron-job.org (free, 1-min, external) vs Vercel Pro (paid, native). Default in design: GitHub Actions.
- **Risk:** external pinger reliability + Hobby function timeout on large videos → mitigated by bounded batches and ~5-min cadence (retries naturally next tick).
