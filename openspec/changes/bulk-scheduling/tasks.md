## 1. Data model & page state (Prompt 1)

- [x] 1.1 Add `VideoItem` interface (`id`, `file`, `videoUrl`, `uploadStatus`, `uploadError`, `duration`, `title`, `tags`, `caption`, `date`, `time`).
- [x] 1.2 Replace single-video scalars with `items: VideoItem[]` (seeded with one empty draft). _`captionMode`/`sharedDate`/`sharedTime` deferred to the prompts that first use them (Prompt 2/4) to avoid unused-state lint; new items default to today + 18:00._
- [x] 1.3 Add `updateItem(id, patch)` immutable helper and `makeDraft()` factory.

## 2. Multi-file upload (Prompt 1)

- [x] 2.1 `UploadCard`: accept multiple files (drop + picker `multiple`); report a `File[]` via `onFilesAdded`.
- [x] 2.2 Page: validate each file (≤ 50MB, accepted type) with per-rejection toast; cap total at 5 with a toast when exceeded.
- [x] 2.3 Create items first (status `uploading`), then upload **sequentially**, updating each item's `videoUrl`/`uploadStatus`/`uploadError`.
- [x] 2.4 Capture per-item duration from `<video>` metadata into `item.duration`.

## 3. Mode switch & layout (Prompt 1)

- [x] 3.1 Derive mode from `items.length` (1 → single, ≥2 → bulk); no stored flag.
- [x] 3.2 Single layout: render existing `UploadCard`/`DescriptionCard`/`ScheduleCard` sourced from `items[0]` via adapter callbacks; keep their internals unchanged.
- [x] 3.3 Bulk layout: vertical list of per-video cards (preview, filename, duration + >60s warning, title, tags, date, time, editable caption textarea, Remove).
- [x] 3.4 Render a disabled "Schedule All (N)" button in bulk with a "wired up later" note.

## 4. Size limit alignment (Prompt 1)

- [x] 4.1 Change `app/api/upload/route.ts` `MAX_BYTES` from 200MB to 50MB.

## 5. Verification (Prompt 1)

- [x] 5.1 Type-check clean on touched files (`tsc --noEmit`; repo eslint config has a pre-existing circular-JSON crash unrelated to these files; IDE diagnostics clean).
- [x] 5.2 Confirm single-mode caption behaviors preserved: Generate gating (video required), Polish visibility (caption non-empty), `usedTranscript` warning, caption cleared on video remove.
- [ ] 5.3 Manual: 1 file → single; 2–5 → bulk cards; 6+ → capped with toast; per-card field edits independent; >50MB rejected on client and server. _(awaiting user manual test)_

## 6. Bulk caption generation (Prompt 2)

- [x] 6.1 Extract `useCaptionAI()` hook: `busy`/`error`/`lastUsedTranscript` state + `generate({title,tags,videoUrl})` and `polish(existingCaption)` that **return** the caption (and `resetWarning`/`clearError`). Duplicates DescriptionCard's fetch logic; DescriptionCard left untouched (Option A). Also added shared `CaptionControls` (buttons + status + warning + error).
- [x] 6.2 Page state: `captionMode: "individual" | "same"` (default individual), `sharedCaption`, and `applyCaptionToAll(text)` helper.
- [x] 6.3 Caption mode toggle rendered above the bulk cards (bulk only); switching modes preserves existing captions.
- [x] 6.4 Same-for-all block: shared textarea (change → broadcast), one hook instance, "Generate from Video N" (first item with `videoUrl`, uses its title+tags, broadcasts), Polish (when shared non-empty, broadcasts), single spinner, shared `usedTranscript` warning + error + helper text.
- [x] 6.5 Individual mode: `BulkVideoCard` uses its own `useCaptionAI()`; render Generate/Polish only when `captionMode === "individual"`; per-card spinner, error, and two-branch `usedTranscript` warning; reset warning when `item.videoUrl` changes.
- [x] 6.6 Verify: `tsc --noEmit` clean on the file; DescriptionCard untouched (single mode unchanged). _(Manual smoke test of loading isolation / broadcast / mode-switch persistence awaiting user.)_

## Deferred (later prompts)

- [ ] 7.1 (Prompt 3) Schedule All client loop, per-card status badges, partial-failure UX, batch toast, partial `handleSuccess`, batch empty-caption confirm.
- [ ] 7.2 (Prompt 4) Auto-space suggestion banner (+1h from first card's time).
- [ ] 7.3 (Cleanup, optional) Reconcile `DescriptionCard` onto `useCaptionAI()` to remove duplication (Option B).
