# Pipeline recovery + resumable storage

Staging artifacts for video generation live outside canonical media trees:

```text
{userId}/resumable/{jobId}/
  manifest.json (in jobs.output.recovery)
  scenes/scene_0.mp4
  audio/tts.mp3
  captions.ass
```

Canonical deliverables remain under `{userId}/videos/generated/…` and `{userId}/photos/generated/…`.

## Job status

- `recoverable` — Replicate/scene work succeeded; Rendi or upload failed. Credits **held** (no refund).
- Resume via `POST /api/generations/resume` with `{ jobId }`.
- TTL default 24h; cron `generation-reconcile` expires stale recoverable jobs (refund + purge).

## Cleanup triggers

| Event | Action |
|-------|--------|
| Success | `purgeResumableJobStorage` after final upload |
| Terminal fail / cancel | Purge + refund |
| TTL expired | Cron terminal + refund + purge |

## Routes

| Route | Recovery |
|-------|----------|
| `generate-reels` | Full (scenes, audio, ASS, Rendi, resume) |
| `generate-video` | Post-Replicate checkpoint + recoverable upload |
| `storyboard-video` | (checkpoint planned; use reels pattern) |
| `motion-control` | Poll finalize (future) |

## Code

- `lib/pipeline-recovery/` — manifest, storage, handle, resume-reels, reconcile
- `lib/storage-buckets.ts` — `userResumablePrefix`, `isResumablePath`

Apply migration: `supabase/migrations/054_job_recoverable_status.sql`
