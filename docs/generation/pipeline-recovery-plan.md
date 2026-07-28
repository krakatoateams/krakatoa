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
- TTL default 24h; cron expires stale recoverable jobs (purge always; refund only if user had resume attempts and delivery still failed).
- Abandon via `POST /api/generations/cancel { jobId }` — purge, no refund.

## Cleanup triggers

| Event | Action |
|-------|--------|
| Success | `purgeResumableJobStorage` after final upload |
| Terminal fail / abandon | Purge; refund only on genuine delivery failure (see refund policy) |
| TTL expired | Cron purge; refund only if `resumeAttempts >= 1` |

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
