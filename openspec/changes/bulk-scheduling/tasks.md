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
- [ ] 5.3 Manual (READY TO TEST): 1 file → single; 2–5 → bulk cards; 6+ → capped with toast; per-card field edits independent; >50MB rejected on client and server. Also verify Prompt 3 (Schedule All: per-card Scheduled ✅/Failed ❌ badges, batch toast "X/N", partial-failure keeps failed cards, "Clear scheduled & keep editing", batch empty-caption confirm) and Prompt 4 (auto-space banner appears on same-date+time collisions; "Auto-space +1h" spaces editable cards). _(awaiting user manual test)_

## 6. Bulk caption generation (Prompt 2)

- [x] 6.1 Extract `useCaptionAI()` hook: `busy`/`error`/`lastUsedTranscript` state + `generate({title,tags,videoUrl})` and `polish(existingCaption)` that **return** the caption (and `resetWarning`/`clearError`). Duplicates DescriptionCard's fetch logic; DescriptionCard left untouched (Option A). Also added shared `CaptionControls` (buttons + status + warning + error).
- [x] 6.2 Page state: `captionMode: "individual" | "same"` (default individual), `sharedCaption`, and `applyCaptionToAll(text)` helper.
- [x] 6.3 Caption mode toggle rendered above the bulk cards (bulk only); switching modes preserves existing captions.
- [x] 6.4 Same-for-all block: shared textarea (change → broadcast), one hook instance, "✨ Generate General Caption" (uses title+tags from **all** cards, no audio/Whisper, via the `general` mode on `/api/generate-caption`; broadcasts), Polish (when shared non-empty, broadcasts), single spinner, error + helper text. _Enabled when ≥1 card has a title or tags. Supersedes the original "Generate from Video N" audio-based design._
- [x] 6.5 Individual mode: `BulkVideoCard` uses its own `useCaptionAI()`; render Generate/Polish only when `captionMode === "individual"`; per-card spinner, error, and two-branch `usedTranscript` warning; reset warning when `item.videoUrl` changes.
- [x] 6.6 Verify: `tsc --noEmit` clean on the file; DescriptionCard untouched (single mode unchanged). _(Manual smoke test of loading isolation / broadcast / mode-switch persistence awaiting user.)_

## Deferred (later prompts)

- [x] 7.1 (Prompt 3) Schedule All client loop, per-card status badges, partial-failure UX, batch toast, batch empty-caption confirm. _Scheduled cards stay visible with a "Scheduled ✅" badge; "Clear scheduled & keep editing" removes saved cards while failed ones remain for retry (re-running Schedule All retries them). Platform fixed to "youtube". Empty caption confirmed once for the whole batch._
- [x] 7.2 (Prompt 4) Auto-spacing across days. _Revised from the original "+1h suggestion" design: spacing is now **automatic on upload** (not a button) — when the batch reaches 2+ videos, new cards are laid into **2 slots/day (12:00 & 18:00)**, rolling to the next day, anchored to the first card's date. Slots are assigned only to newly added cards (Option B) so manual edits on existing cards are preserved. The banner is now **informational only** (muted blue/slate ℹ️, no CTA), shown whenever `items.length ≥ 2`._
- [x] 7.3 (Cleanup) Reconcile `DescriptionCard` onto `useCaptionAI()` + `CaptionControls` to remove duplication (Option B).
