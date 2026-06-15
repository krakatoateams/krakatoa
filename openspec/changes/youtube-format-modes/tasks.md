# Tasks

## 1. Data model + metadata capture
- [x] 1.1 Add `format: "short" | "video"`, `formatTouched: boolean`, and `aspect: { w: number; h: number } | null` to `VideoItem` (default `format: "short"`, `formatTouched: false`, `aspect: null`)
- [x] 1.2 Add a `suggestFormat(durationSec, aspect)` helper (portrait && ≤180s → short, else video)
- [x] 1.3 Capture `videoWidth`/`videoHeight` in the single-mode `onLoadedMetadata` handler and run auto-suggest when `!formatTouched`
- [x] 1.4 Capture `videoWidth`/`videoHeight` in the bulk-mode `onLoadedMetadata` handler and run auto-suggest when `!formatTouched`

## 2. Format toggle UI
- [x] 2.1 Add Short/Video toggle to single `ScheduleCard`; toggling sets `formatTouched = true`
- [x] 2.2 Add Short/Video toggle to `BulkVideoCard`; toggling sets `formatTouched = true`

## 3. Mode-aware validation
- [x] 3.1 Remove the hard 60s `durationOk` block from single `isReady`
- [x] 3.2 Remove the hard 60s block from bulk readiness/`overLimit`
- [x] 3.3 Add advisory warnings: short>3min, short non-vertical (single + bulk); video → none; unknown → none

## 4. Adaptive preview
- [x] 4.1 Single preview frame switches 9:16 (short) / 16:9 (video)
- [x] 4.2 Bulk preview frame switches 9:16 (short) / 16:9 (video)

## 5. Mode-aware captions + #Shorts
- [x] 5.1 `useCaptionAI().generate()` sends `format`; thread format through call sites (single + bulk)
- [x] 5.2 `/api/generate-caption` accepts `format` and branches prompt (short vs video)
- [x] 5.3 On schedule, append `#Shorts` to description for shorts if missing (single + bulk handlers)

## 6. ReelsGen
- [x] 6.1 Show "Schedule to YouTube" for storyboard (16:9) output (remove `!resultIsStoryboardFormat` gate)

## 7. Verification
- [x] 7.1 `npx tsc --noEmit` passes
- [x] 7.2 Lint clean on edited files
- [ ] 7.3 Manual: vertical clip → suggests Short with #Shorts caption; 16:9/long clip → suggests Video, schedulable, no #Shorts; override persists
