## Context

The scheduler (`app/(app)/tools/scheduler/page.tsx`) models everything as `VideoItem[]`. Today the only source is a device upload: `UploadCard` collects a `File`, the page POSTs it to `/api/upload`, and stores the returned Supabase public URL in `item.videoUrl`. Preview and duration both derive from the `File` (an object URL + `<video onLoadedMetadata>`).

Separately, every generated video already lives in the creations library (`GET /api/creations/history` → `CreationHistoryItem[]`), and `components/CreationsHistory.tsx` is a reusable gallery that fetches+renders those items and reports selection through an `onSelect(item)` callback. Its `mediaUrl` is the same kind of Supabase public URL `/api/upload` produces.

The opportunity: let users pick an existing video creation as a schedulable item — no download/re-upload.

## Goals / Non-Goals

**Goals:**
- Tabbed Upload section: `[📁 Upload from device] [🎬 My Assets]`, in single and bulk mode.
- Picking an asset appends/fills exactly one `VideoItem` with `videoUrl = mediaUrl`, `uploadStatus: "done"`, `file: null` — no `/api/upload` call.
- Capture duration from the asset URL and reuse the existing >60s amber guard.
- Reuse `CreationsHistory` as-is (filtered to the three video tools).

**Non-Goals:**
- No multi-select from assets (one pick = one card) in v1.
- No image assets.
- No change to `DescriptionCard`, caption AI, `/api/upload`, `ScheduleCard` scheduling, or Schedule All.
- No new backend endpoints.

## Decisions

### 1. Asset selection bypasses the upload pipeline
A picked asset is already hosted, so the page handler sets `{ videoUrl: mediaUrl, uploadStatus: "done", file: null, scheduleStatus: "idle" }` directly. Single mode fills `items[0]`; bulk mode appends a new `VideoItem` (respecting `MAX_VIDEOS = 5`) and auto-spacing applies as for uploads. Alternative considered: download the asset to a `File` and run it through `/api/upload` — rejected as wasteful (re-hosting an already-hosted file) and slower.

### 2. Preview + duration source generalized to `videoUrl ?? objectURL(file)` (answer to pre-impl Q1)
This is the only touch to single-mode-shared code, and it is **additive**: the `file` branch is unchanged; a fallback is added for when `file` is null but `videoUrl` exists.

In `UploadCard` the effect that builds `previewUrl` (currently `lib/.../page.tsx` ~L266–276) gains a fallback: if `!file && videoUrl`, set `previewUrl = videoUrl` (no object URL to revoke). The preview render gate (`previewUrl && uploadStatus === "done"`) and the `<video onLoadedMetadata={handleLoadedMetadata}>` are unchanged, so duration capture works identically off the asset URL. `BulkVideoCard` similarly derives `previewUrl` from `item.file` (~L1100) and gets the same `?? item.videoUrl` fallback.

Because the device-upload path always has a `file`, it never hits the new branch — single mode's existing behavior is byte-for-byte preserved. **Conclusion: minimal and low-risk.**

### 3. `CreationsHistory` is reused unchanged (answer to pre-impl Q2)
It already exposes `onSelect?: (item: CreationHistoryItem) => void` and `selectedUrl?: string | null`, and the `tools`/`mediaType` filter props. The `tools/reels/page.tsx` integration proves the pattern (`onSelect={(item) => setVideoUrl(item.mediaUrl)}`). **No change to the component is needed.** We pass `tools={["reels_seedance","reels_veo","storyboard_video"]}`, `mediaType="video"`.

### 4. Asset URLs are directly playable (answer to pre-impl Q3)
`CreationsHistory` already renders `<video src={item.mediaUrl} preload="metadata">` for video items, and `tools/reels/page.tsx` plays a selected `mediaUrl` in a `<video>`. They are public Supabase URLs. **Yes — directly playable**, and the same `<video>` element captures duration via `onLoadedMetadata`.

### 5. Tab UI lives inside `UploadCard`
A small two-button segmented toggle at the top of `UploadCard`'s body: "Upload from device" keeps the existing drop zone; "My Assets" swaps in the `CreationsHistory` grid. Tab state is local to `UploadCard`. Selecting an asset calls a new `onAssetSelected(mediaUrl: string)` prop.

## Risks / Trade-offs

- **Cross-origin metadata read** → Supabase public buckets serve permissive headers and the gallery already loads these URLs in `<video>`; if a specific bucket blocks metadata, `duration` stays `null` and the item is still schedulable (the >60s guard only triggers on a known duration). Verify during implementation.
- **Touching shared `UploadCard`** (single mode) → mitigated by the additive fallback (Decision 2); device-upload path is unaffected because `file` is always present there.
- **Single-pick only** → picking 5 assets means 5 clicks; acceptable for v1, multi-select deferred.
- **Asset longer than 60s** (Veo/Seedance reels often are) → handled by the existing amber >60s banner + `ScheduleCard.isReady` / bulk `itemReady` duration gate; no new logic.

## Open Questions

- None blocking. Multi-select asset picking and an image→thumbnail path are explicitly deferred to a later change.
