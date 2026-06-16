## Context

`app/api/cron/route.ts` already implements the publish loop: fetch posts where `status = "scheduled"` and `scheduled_time <= now`, upload each via `uploadToYouTube`, mark `published`/`failed`. It is `CRON_SECRET`-protected. The only thing missing is a *trigger* that calls it on a useful cadence — `vercel.json` registers only the storage-sweep. The deployment target is **Vercel Hobby** (cron: once/day, max 2 jobs; function runtime capped ~60s).

## Goals / Non-Goals

**Goals:**
- Due posts publish automatically, within minutes, on Hobby, for free.
- Posts never silently sit "stuck"; the UI distinguishes scheduled / overdue / published / failed.
- Stay within Hobby function limits.

**Non-Goals:**
- No move to a queue/worker system.
- No change to the upload mechanism itself.
- No paid plan required (Pro documented only as an alternative).

## Decisions

### 1. Trigger via a committed GitHub Actions scheduled workflow (recommended)
`.github/workflows/publish-cron.yml` on `schedule: */5 * * * *` runs a single `curl` against `${PROD_URL}/api/cron` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Free, version-controlled, no extra dashboard. GitHub may delay scheduled runs a few minutes under load — acceptable (vastly better than once/day).
- **Alternative:** cron-job.org for true 1-minute cadence via an external dashboard.
- **Alternative:** Vercel Pro → native `vercel.json` per-minute cron (no external dependency, paid).
- The endpoint is unchanged regardless of trigger, so switching later is trivial.

### 2. Bounded batch + explicit maxDuration (Hobby-safe)
`/api/cron` processes at most `N` due posts per invocation (start `N = 3`, tunable) ordered by `scheduled_time`, and sets `export const maxDuration = 60`. A backlog drains over successive ~5-min ticks. Prevents a single slow/large upload from timing out the whole run.

### 3. "Overdue" is a derived display state, not a DB status
The DB keeps `scheduled | published | failed`. The UI derives **overdue/processing** when `status === "scheduled" && scheduled_time < now`. This avoids mislabeling un-attempted posts as "failed" (failed = an attempt was made and rejected). Pure presentation; no migration.

### 4. Storage-sweep stays on Vercel daily cron
Cleanup tolerates once/day; no need to move it to the external pinger. Keeps us within Hobby's 2-cron budget (sweep is the only Vercel cron; publisher is external).

## Risks / Trade-offs

- **External trigger reliability** — if GitHub Actions is delayed/paused (e.g. repo inactivity disables scheduled workflows after 60 days), publishing stalls. Mitigation: documented; cron-job.org/Pro as fallbacks; overdue badge makes stalls visible.
- **Function timeout on large videos** — bounded batch + 60s cap reduce but don't eliminate; a single >60s upload would fail and be retried next tick (and correctly marked failed after repeated attempts). Acceptable for typical Shorts/short videos.
- **No de-dup across overlapping ticks** — if two pings overlap, a post could be picked twice. Low risk at 5-min cadence + short batches; a future `status = "publishing"` lock could harden it (deferred).

## Alternatives Considered

- **Native Vercel cron on Hobby** — rejected: once/day only.
- **Vercel Pro** — viable, clean, but recurring cost; kept as documented alternative.
- **Self-pinging via client** — rejected: unreliable, requires an open tab.
