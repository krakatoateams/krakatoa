## Context

`app/(app)/tools/scheduler/page.tsx` models items as `VideoItem[]`. Each card captures duration from `<video onLoadedMetadata>` and gates scheduling on `duration <= 60` (single: `durationOk` in `isReady`; bulk: per-item `overLimit` + batch readiness). Previews are hardcoded `aspect-[9/16]`. `useCaptionAI().generate()` posts `{ title, tags, videoUrl }` to `/api/generate-caption`, whose prompt is always Shorts-flavored (adds `#Shorts`). `lib/youtube.ts#uploadToYouTube` sends `description`/`tags` as-is; YouTube auto-classifies Short vs video by aspect + duration.

## Goals / Non-Goals

**Goals:**
- Let each card be a **Short** or a **Video**, suggested from metadata, user-overridable.
- Stop blocking long/16:9 content; replace with advisory warnings.
- Make preview + caption mode-aware; auto-tag Shorts with `#Shorts`.
- Let 16:9 ReelsGen output reach the scheduler.

**Non-Goals:**
- No `posts.format` DB column (deferred).
- No hard block for non-vertical Shorts (warn only).
- No `privacyStatus` change.
- No change to the upload mechanism or YouTube API call shape.

## Decisions

### 1. `format` lives per-item on `VideoItem`
`VideoItem` gains `format: "short" | "video"` and `aspect: { w: number; h: number } | null`. Per-item (not a global toggle) so a batch can mix Shorts and Videos. Default before metadata loads: `"short"` (preserves today's default intent) — re-suggested once dimensions are known unless the user already overrode it.

### 2. Auto-suggest from aspect + duration, override-aware
On metadata load, compute a suggestion: `portrait (h > w) AND duration ≤ 180s → "short"`, else `"video"`. Apply the suggestion only if the user hasn't manually toggled this card (`formatTouched` flag). Manual toggle sets `formatTouched = true` and wins thereafter.

### 3. Duration no longer blocks scheduling
Remove `durationOk` from `isReady` (single) and the duration condition from bulk readiness. Scheduling is gated only by `videoUrl + title + date + time`. Duration/aspect produce **warnings**, never disable the button.

### 4. Mode-aware warnings (advisory)
- `short` + `duration > 180s` → "Over 3 min — will publish as a regular video, not a Short."
- `short` + `aspect` known and not portrait → "Not vertical — Shorts should be 9:16."
- `video` → no duration/aspect warning.
Unknown duration/aspect → no false warning (consistent with `schedule-from-assets`).

### 5. Adaptive preview frame
Preview container uses `aspect-[9/16]` when `format === "short"`, else `aspect-video` (16:9). The `<video>` stays `object-contain` so letterboxing is graceful if the actual ratio differs from the frame.

### 6. Mode-aware caption + `#Shorts`
`generate()` sends `format`. `/api/generate-caption` adds a `format` param: `short` → existing Shorts prompt; `video` → a longer-form description prompt (hook + 2–4 sentence body + a few tags, **no** forced `#Shorts`, allow > 300 chars). On **schedule**, if `format === "short"` and the description lacks `#Shorts`, append it (idempotent) before `POST /api/posts`. Done client-side so no schema/route change is needed for tagging.

### 7. ReelsGen unhides Schedule for storyboard
Remove the `!resultIsStoryboardFormat` gate on the "Schedule to YouTube" button. The 16:9 storyboard URL flows to the scheduler, where auto-suggest picks `"video"`. (Optionally pass `&format=video`, but auto-suggest already handles it from the loaded dimensions.)

## Risks / Trade-offs

- **Relaxing the 60s gate** is load-bearing — must remove it from both single `isReady` and bulk readiness, and delete/repurpose the "under 60s" copy. Mitigation: scheduling never blocks on duration now; covered by warnings.
- **Aspect read from cross-origin Supabase URLs**: `videoWidth/Height` are available without CORS taint (unlike pixel reads), so metadata capture works for asset-backed items too.
- **Mixed-format bulk** complicates the per-card UI slightly; acceptable for the flexibility.

## Alternatives Considered

- **Global batch toggle** — simpler UI but can't mix formats; rejected per product choice (per-card).
- **Persist `posts.format`** — useful for analytics and server-side `#Shorts` tagging, but adds a migration; deferred. Client-side `#Shorts` append covers the immediate need.
- **Hard-block non-vertical Shorts** — rejected; warn-only keeps the flow unblocked.
