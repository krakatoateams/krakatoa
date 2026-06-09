## 1. Preview + duration generalization (shared, low-risk)

- [x] 1.1 In `UploadCard`, generalize the preview effect: when `!file && videoUrl`, set `previewUrl = videoUrl` (no object URL created/revoked); keep the existing `file` branch untouched.
- [x] 1.2 In `BulkVideoCard`, derive `previewUrl` from `item.file` object URL `?? item.videoUrl` (fallback only when no file).
- [x] 1.3 Verify the preview gate and `<video onLoadedMetadata>` still drive duration capture for asset URLs (no gate change expected).

## 2. Asset source tab in UploadCard

- [x] 2.1 Add local tab state to `UploadCard` (`"upload" | "assets"`, default `"upload"`) and a segmented `[📁 Upload from device] [🎬 My Assets]` toggle at the top of the card body.
- [x] 2.2 Render the existing drop zone under the "upload" tab unchanged.
- [x] 2.3 Under the "assets" tab, embed `CreationsHistory` with `mediaType="video"`, `tools={["reels_seedance","reels_veo","storyboard_video"]}`, and `onSelect`. _(Used `limit={24}`, custom title/description, and `!mt-0 !border-t-0 !pt-0` to neutralize the gallery's standalone-page spacing inside the card.)_
- [x] 2.4 Add an `onAssetSelected(mediaUrl: string)` prop to `UploadCard`; wire the gallery's `onSelect` to call it with `item.mediaUrl`.

## 3. Page wiring (single + bulk)

- [x] 3.1 Add a page handler that, given a `mediaUrl`, builds an asset-backed `VideoItem` patch (`videoUrl`, `uploadStatus: "done"`, `file: null`).
- [x] 3.2 Single mode: apply the patch to `items[0]` (fill the current draft). _Handler fills the first empty draft in place, so picking one asset keeps single mode single._
- [x] 3.3 Bulk mode: append a new asset-backed `VideoItem` if under `MAX_VIDEOS` (toast when at the limit); apply auto-spacing consistent with uploads (`spacedSlot`, Option B — only the new card).
- [x] 3.4 Pass `onAssetSelected` to both the single-mode and bulk-mode `UploadCard` instances.

## 4. Verification

- [x] 4.1 `tsc --noEmit` clean; no new lint errors.
- [x] 4.2 Confirm single mode device-upload preview/duration/scheduling unchanged (file path never hits the new fallback — the `file` branch is byte-for-byte the same; the new branch only runs when `file` is null).
- [ ] 4.3 Manual (READY TO TEST): pick an asset in single mode → fills item0, plays, duration shows; pick in bulk → appends a card; >60s asset shows amber warning; 5-video cap enforced.
- [ ] 4.4 Manual (READY TO TEST): verify cross-origin duration read from a Supabase asset URL (and that unknown duration does not show a false >60s warning).
