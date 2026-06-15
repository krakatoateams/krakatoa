## 1. Sweep logic library

- [x] 1.1 Create `lib/storage-sweep.ts` with a recursive lister for `videos/` returning `{ path, size, createdAt }` per object (using Supabase `storage.list` pagination; `created_at` with `updated_at` fallback).
- [x] 1.2 Add a reference collector that reads `user_creations(media_url, storage_path)`, `posts(video_url)`, `storyboards(video_url, storyboard_url)`; tolerate a missing table (skip with a warning).
- [x] 1.3 Implement `isReferenced(path, refBlob)` = full-path match OR basename fallback, including `decodeURIComponent` variants.
- [x] 1.4 Implement `planStorageSweep({ minAgeHours })` → `{ keep, deletable, totals }`, where `deletable` = `videos/temp/*` OR (unreferenced AND age > threshold). Skip objects with no timestamp.
- [x] 1.5 Implement `runStorageSweep({ dryRun, minAgeHours })` → plans, and when not dry-run deletes in batches of 100 via `storage.remove`; return counts + reclaimed bytes.

## 2. Cron endpoint

- [x] 2.1 Create `app/api/cron/storage-sweep/route.ts` (`GET`), `maxDuration` headroom, `CRON_SECRET` Bearer guard mirroring `app/api/cron/route.ts`.
- [x] 2.2 Parse `?dryRun=1` and optional `?minAgeHours=`; call `runStorageSweep`; return JSON `{ dryRun, deleted, keptReferenced, reclaimedBytes, ... }`.
- [x] 2.3 On error, log and return a JSON error with status 500.

## 3. Scheduling + config

- [x] 3.1 Add `vercel.json` with a daily cron for `/api/cron/storage-sweep` (`0 3 * * *`).
- [x] 3.2 Document the endpoint + `CRON_SECRET` + dry-run usage (brief comment in route; note in proposal already covers ops).

## 4. Verification

- [x] 4.1 `tsc --noEmit` clean; no new lint errors.
- [ ] 4.2 Manual (READY TO TEST): call `/api/cron/storage-sweep?dryRun=1` in prod with the Bearer secret → confirm plan lists only temp/old-orphans and KEEPs the 15 referenced files.
- [ ] 4.3 Manual (READY TO TEST): upload a video and immediately dry-run → confirm the fresh upload is NOT in the deletable set (age guard).
- [ ] 4.4 Manual (READY TO TEST): run once for real → re-audit shows reclaimed space and referenced files intact.
