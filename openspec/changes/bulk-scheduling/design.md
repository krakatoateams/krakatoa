## Context

The scheduler page (`app/(app)/tools/scheduler/page.tsx`) is shaped around single-video scalars (`videoUrl`, `title`, `tags`, `caption`, `videoDuration`, upload status). Uploads fire immediately on file select via `/api/upload` (one file per call) and return a Supabase public URL. Scheduling posts one row at a time via `POST /api/posts`. Bulk requires moving from scalars to an array of per-video records while preserving the carefully-tuned single-video caption UX.

## Data Model

```ts
interface VideoItem {
  id: string;                 // crypto.randomUUID()
  file: File | null;          // kept only for preview/duration capture; may be dropped after upload
  videoUrl: string | null;    // Supabase public URL after upload
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError: string | null;
  duration: number | null;    // seconds, from <video> metadata
  title: string;
  tags: string;
  caption: string;
  date: string;               // "YYYY-MM-DD"
  time: string;               // "HH:mm"
}
```

Page-level state: `items: VideoItem[]` (always length ≥ 1; seeded with one empty draft), `captionMode: "individual" | "same"`, `sharedDate`, `sharedTime`.

## Key Decisions

- **Draft item:** `items` always holds at least one item. Before any upload, `items[0]` is an empty draft (`file: null`) so the single-video form (title/tags/caption) stays editable pre-upload, matching today's behavior. `VideoItem.file` is therefore nullable.
- **Mode is derived:** `items.length === 1` → single layout; `>= 2` → bulk. No stored mode flag.
- **Preserve single-video components:** `DescriptionCard` and `ScheduleCard` keep their existing prop signatures and internals (including caption Generate/Polish gating, the soft empty-caption confirm, and the `usedTranscript` warning). The page feeds them from `items[0]` via adapter callbacks (`onCaptionChange` → `updateItem(items[0].id, { caption })`, etc.). This is the lowest-risk path and was chosen explicitly to avoid regressions. `date`/`time` remain `ScheduleCard`-internal in single mode; the per-item `date`/`time` fields are used in bulk.
- **Sequential upload:** new items are created first (status `uploading`), then uploaded one at a time, updating each item's `videoUrl`/`uploadStatus` as it resolves.
- **Schedule All = client loop** of `POST /api/posts` (Prompt 3); no new endpoint, simpler partial-failure handling.

## State transitions (upload)

```
existingReal = items.filter(i => i.file)        // already-real videos
incoming     = validate(droppedFiles)           // size ≤ 50MB, accepted type
combined     = (existingReal + incoming) capped at 5
items = combined.length === 0 ? [emptyDraft()]
      : combined                                // length 1 → single, ≥2 → bulk
then upload sequentially any item with file && !videoUrl
```

## Prompt 2 — Bulk caption generation

- **Reuse strategy (Option A):** extract a `useCaptionAI()` hook that holds per-instance transient state (`busy`, `error`, `lastUsedTranscript`) and exposes `generate()`/`polish()` that **return** the caption string (caller decides where to store it). `DescriptionCard` is left **untouched** — the hook duplicates its fetch logic for now. Reconciling `DescriptionCard` onto the hook is a deferred cleanup (Option B), not part of Prompt 2. Rationale: zero regression risk to single mode, consistent with Prompt 1's freeze.
- **Caption mode:** page-level `captionMode: "individual" | "same"` (default `individual`) + `sharedCaption: string`. Toggle renders above the bulk cards (bulk only). Switching modes never clears captions.
- **Individual mode:** each `BulkVideoCard` owns a `useCaptionAI()` instance → per-card spinner, error, and `usedTranscript` warning. Generate gated on `item.videoUrl`; Polish visible when `item.caption` non-empty.
- **Same-for-all mode:** a shared textarea + one `useCaptionAI()` instance at the top. "Generate from Video N" uses the **first item with a `videoUrl`** and feeds that item's title+tags; result broadcasts to every item via `applyCaptionToAll()`. Editing the shared box also broadcasts live; editing a card afterward diverges just that card. Per-card Generate/Polish buttons are hidden in this mode (textareas stay editable).
- **Known trade-off:** in same-for-all, all captions derive from Video 1's audio. Surfaced in helper text ("Generated from Video N's audio — applies to all").

## Risks / Trade-offs

- **Refactor regression risk (highest):** single-mode caption behaviors. Mitigation: keep `DescriptionCard`/`ScheduleCard` unchanged internally; verify the four behaviors after implementing.
- **Behavior delta:** removing the single video resets `items[0]` to a fresh draft, clearing title/tags too (previously title/tags persisted on remove). Accepted — caption clearing is the contractually required behavior.
- **Upload bandwidth:** 5 × 50MB sequential; acceptable for v1, progress shown per video.
