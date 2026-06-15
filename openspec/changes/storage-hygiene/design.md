## Context

One public Supabase Storage bucket (`STORAGE_BUCKET`, default `krakatoa`) holds everything under feature folders: `videos/` (ReelsGen/Seedance/Veo finals + device uploads), `videos/temp/` (transient), `videos/storyboard/`, and `photos/`. Writers exist in many routes (`generate*`, `upload/sign`, `product-photo*`); the only deletes are transient `.srt` files. Result: monotonic growth → free-tier 1 GB exceeded.

Audit (read-only, 2026-06-15):
```
videos/ : 68 files · 1.19 GB   →  KEEP 15 (150 MB) · ORPHAN 51 (1.04 GB) · TEMP 2 (1.3 MB)
photos/ : 13 files · 16.8 MB
```
Orphans were repeated test uploads (`IMG_9937.MOV` ×15, `video_testing_no_audio.mov` ×17, screen recordings, etc.) — uploaded then never scheduled. A manual delete reclaimed 1.04 GB; this change automates prevention.

## Goals / Non-Goals

**Goals:**
- Automatically remove transient (`videos/temp/`) and orphaned `videos/` objects so the bucket self-heals.
- Never delete files that are referenced or still in active use (in-progress session).
- Be verifiable before destructive action (dry-run) and safe to run unattended (secret + age guard).

**Non-Goals:**
- Changing the upload flow (no defer-until-schedule — see Decision 1).
- Sweeping `photos/` (small; can extend later).
- User-facing delete / creation retention (Block C, deferred).
- Storage provider migration (Cloudflare R2 — see Alternatives).

## Decisions

### 1. Keep immediate upload; do NOT defer upload until "Schedule" (caption-gen constraint)
Caption generation posts `videoUrl` to `/api/generate-caption`, which calls `extractAudioMp3(sourceUrl)` → **Rendi**, an external service that **fetches the URL** to pull audio. A browser `blob:` URL is not reachable externally, so if we deferred upload until Schedule, "Generate Caption" (which runs *before* scheduling) would fail with the exact transcription error class we just fixed. Therefore the file must be hosted at caption time. We keep uploading on drop and rely on the sweep + age guard to clean abandoned uploads. *Alternative considered:* upload to a `videos/staging/` area and "promote" on schedule — rejected as more moving parts (a move step + URL rewrite on the saved post) for no functional gain over an age-guarded sweep.

### 2. Orphan = not referenced by any known table, matched conservatively
Referenced strings are pulled from `user_creations(media_url, storage_path)`, `posts(video_url)`, `storyboards(video_url, storyboard_url)`. An object `videos/<path>` is **referenced** if any reference string contains its full path **or** (fallback) its basename. The basename fallback is deliberately over-inclusive: when uncertain, treat as referenced (keep), never delete. Decoded (`decodeURIComponent`) variants are also matched to handle URL-encoded names.

### 3. Age guard (default 24h) makes immediate-upload safe
A normal session (drop → caption → schedule) completes in minutes, so a freshly uploaded, not-yet-referenced file must NOT be swept. The sweep only deletes an unreferenced object when its storage `created_at` (fallback `updated_at`) is older than `SWEEP_MIN_AGE_HOURS` (default 24). If neither timestamp is present, the object is skipped (treated as too-new). `videos/temp/` files are also age-gated.

### 4. Thin route, testable lib
`lib/storage-sweep.ts` exposes `planStorageSweep()` → `{ keep, deletable, ... }` (pure-ish: lists storage + reads DB, no deletes) and `runStorageSweep({ dryRun, minAgeHours })` which plans then deletes in batches of 100. The route `GET /api/cron/storage-sweep` only does auth + param parsing + calls the lib + returns JSON.

### 5. Secret-protected, dry-run-able, daily cron
Auth mirrors `/api/cron`: if `CRON_SECRET` is set, require `Authorization: Bearer <CRON_SECRET>`. `?dryRun=1` returns the plan without deleting. `vercel.json` schedules it daily (`0 3 * * *`); 24h threshold tolerates once-daily cadence. Can also be triggered manually for the first verified run.

## Risks / Trade-offs

- **False delete of an in-use file** → mitigated by conservative match + age guard + dry-run.
- **Orphans linger up to ~24h + cron interval** → acceptable; bounded growth vs. unbounded today.
- **DB/storage drift** (a referenced row whose file is gone) → harmless for the sweep (we only delete *unreferenced* files).
- **Hobby plan cron limits** (daily) → fine given the 24h threshold.

## Alternatives Considered

### Cloudflare R2 (future option, not now)
R2 is object storage with a **10 GB free tier** (vs Supabase 1 GB) and **zero egress fees**, then `$0.015/GB-mo`. Attractive for video because Rendi + YouTube + previews all download (egress) the files. **Rejected for now** because: (a) the immediate "full" problem is already solved by cleanup; (b) migration is its own project (swap upload signing to S3-compatible API, public URL/CORS setup, rewrite existing Supabase URLs stored in DB); and (c) **hygiene is still required regardless** of provider — a bigger bucket without a sweep just fills more slowly. **Revisit R2 when** kept content grows into the tens of GB or video-delivery bandwidth becomes a meaningful cost. Caption-gen and YouTube upload remain compatible (both need only a public URL, which R2 provides).

### Supabase Pro ($25/mo → 100 GB)
Buys headroom without code, but doesn't fix the root cause (no cleanup). Orthogonal to this change; a budget decision.
