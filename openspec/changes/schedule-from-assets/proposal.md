## Why

Creators already generate Shorts-ready videos inside the app (ReelsGen, Seedance, Veo) and those land in their creations library with hosted Supabase URLs. Today the scheduler only accepts a fresh device upload, so a user who just generated a reel has to download it and re-upload it to schedule it. Letting them pick an existing video asset directly removes that round-trip and ties the generate → schedule flow together.

## What Changes

- Add a tabbed entry point to the scheduler's Upload section: **[📁 Upload from device] [🎬 My Assets]**. Tabs appear in **both single and bulk mode**.
- "My Assets" embeds the existing `CreationsHistory` gallery filtered to **video assets only** (`reels_seedance`, `reels_veo`, `storyboard_video`) — no images.
- **Single-pick (v1):** selecting an asset appends **one** video card (single mode → fills `items[0]`; bulk mode → appends a new `VideoItem`). No multi-select.
- A picked asset sets `videoUrl = item.mediaUrl` directly with `uploadStatus: "done"` and **no `/api/upload` call** (the asset is already hosted). `file` stays `null`.
- **Duration:** capture from the asset URL's `<video>` metadata (same `onLoadedMetadata` mechanism), and show the existing amber **>60s** warning when it exceeds Shorts length.
- Generalize the video **preview + duration source** from "File object URL only" to "`videoUrl` when there's no `file`" so asset-backed cards preview and gate correctly.
- **Out of scope / unchanged:** `DescriptionCard`, caption Generate/Polish, the `/api/upload` device-upload pipeline and its validation, `ScheduleCard` scheduling logic, and Schedule All.

## Capabilities

### New Capabilities

- `schedule-from-assets`: Select an existing hosted video creation as a schedulable item in the scheduler (single + bulk), without re-uploading, including duration capture and the >60s guard.

### Modified Capabilities

- _(none — no existing `openspec/specs/` baseline in-repo; the scheduler's bulk/single behavior is captured in the `bulk-scheduling` change, not a spec.)_

## Impact

- **Frontend:** `app/(app)/tools/scheduler/page.tsx` — `UploadCard` gains an Upload/Assets tab toggle and embeds `CreationsHistory`; preview + duration generalized to `videoUrl ?? objectURL(file)`; a new `onAssetSelected(mediaUrl)` page handler appends/fills a `VideoItem`. The `bulk-scheduling` auto-spacing applies to asset-added cards too.
- **Components:** `components/CreationsHistory.tsx` — reused as-is via its existing `onSelect`/`selectedUrl` props (no change expected).
- **Backend:** none. Reuses `GET /api/creations/history` and `POST /api/posts`. No `/api/upload` change.
- **Risk:** the preview/duration generalization touches `UploadCard`, which single mode renders. Mitigation: change is additive (fallback only when `file` is null), and the existing device-upload path keeps using the `file` object URL unchanged.
- **Unknowns to verify (see design):** cross-origin `<video>` metadata duration read from Supabase public URLs; bulk multi-pick deferred to a later version.
