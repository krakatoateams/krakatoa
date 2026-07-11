# Tasks

## 1. Client state: per-platform result tracking
- [x] 1.1 `app/(app)/tools/scheduler/page.tsx` — added `PlatformResult = { status: "success" | "failed"; error?: string }` and `platformResults: Partial<Record<"youtube" | "tiktok", PlatformResult>>` on `VideoItem`
- [x] 1.2 `makeDraft()` — defaults `platformResults: {}`. Also: unchecking a platform in `PlatformFields` now clears its stale `platformResults` entry (not in the original task list, but necessary — otherwise re-checking a platform later could be silently skipped as "already succeeded")

## 2. Single mode (`handleSubmit`)
- [x] 2.1 Computes `pendingPlatforms = platforms.filter((p) => platformResults[p]?.status !== "success")`; if empty (plus other readiness checks), `handleSubmit` no-ops and `isReady` disables the button
- [x] 2.2 Only `POST /api/posts` for `pendingPlatforms`
- [x] 2.3 After `Promise.allSettled`, merges this attempt's outcomes into `platformResults` via `onPlatformPatch`
- [x] 2.4 `resetForm()` runs only when every platform now has `status === "success"` (merged across attempts) — **deviation, see below**: also required moving the `onSuccess()` call (full item wipe) to only fire on full success, since it was previously called unconditionally and would have discarded `platformResults` immediately after every attempt, making the retry fix inert for single mode

## 3. Bulk mode (`handleScheduleAll`)
- [x] 3.1 Computes `pendingPlatforms` per target item the same way, before the `Promise.allSettled` batch
- [x] 3.2 Merges this attempt's outcomes into `platformResults` per item via `updateItem`
- [x] 3.3 `scheduleStatus` becomes `"scheduled"` only when every platform has `status === "success"` in the merged results; the stale inline comment describing duplication as an accepted limitation is removed

## 4. Bulk mode UI: per-platform status display
- [x] 4.1 `BulkVideoCard` — `item.platforms.length === 1` keeps the exact original badge markup, untouched
- [x] 4.2 `item.platforms.length > 1` renders one small pill per platform sourced from `platformResults` (e.g. "YouTube ✓" / "TikTok ✗"), replacing the single badge only in that case

## 5. Verification
- [x] 5.1 `npx tsc --noEmit` passes
- [x] 5.2 Lint clean on edited files (3 pre-existing warnings elsewhere in the file, unrelated to this change)
- [ ] 5.3 Manual: schedule a video to YouTube + TikTok in bulk mode where the TikTok request is forced to fail (e.g. temporarily disconnect TikTok or use an invalid privacy level to trigger the 400 from `POST /api/posts`); confirm the card shows "YouTube ✓ / TikTok ✗"; click "Schedule All" again; confirm via Supabase (or the Calendar view) that only ONE YouTube `posts` row exists, not two
- [ ] 5.4 Manual: repeat 5.3 in single mode (`handleSubmit`/"Schedule Post"), confirming the same no-duplicate-resubmit behavior
- [ ] 5.5 Manual: confirm single-platform scheduling (today's common case) looks and behaves identically to before this change
