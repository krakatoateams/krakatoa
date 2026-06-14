## Context

ReelsGen (`app/(app)/tools/reels/page.tsx`) renders generated videos into a shared `videoUrl` state and shows a "Final Result" card when `videoUrl` is non-null. Three engines (Seedance, Veo, storyboard-video) plus a dev test path all converge on that single `videoUrl`. A companion boolean, `resultIsStoryboardFormat`, records whether the current result is a 16:9 storyboard clip (`true`) or a 9:16 reel (`false`); it is set `false` by the reel engines and `true` by the storyboard path, and is kept accurate even when a history item is re-selected (`item.tool === "storyboard_video"`).

The scheduler (`app/(app)/tools/scheduler/page.tsx`) already has `handleAssetSelected(mediaUrl: string)` (added by `schedule-from-assets`): it builds an asset-backed `VideoItem` (`videoUrl = mediaUrl`, `uploadStatus: "done"`, `file: null`), filling the first empty draft or appending a new card (respecting `MAX_VIDEOS`, with auto-spacing). It currently has **no** awareness of URL query params — no `useSearchParams`, no `useRouter`.

The opportunity: wire ReelsGen's result directly to `handleAssetSelected` through a deep link, so a freshly generated reel can be scheduled in one click.

## Goals / Non-Goals

**Goals:**
- A "Schedule to YouTube" button on the ReelsGen result for vertical reels only.
- Deep link carries the hosted video URL and the theme as a title: `?assetUrl=&title=`.
- Scheduler consumes the params once on mount via `handleAssetSelected`, pre-filling the title.
- Correct App Router handling: `useSearchParams()` under `<Suspense>`.

**Non-Goals:**
- Storyboard (16:9) hand-off.
- Multi-asset deep links; passing tags/caption/duration.
- Any change to scheduling, caption AI, `/api/upload`, or `handleAssetSelected`'s internals.

## Decisions

### 1. Button gate is `videoUrl && !resultIsStoryboardFormat` (answer to pre-impl Q4)
No new reel-vs-storyboard detection is needed. `resultIsStoryboardFormat` is the existing, already-maintained differentiator:
- `false` ← Seedance (`handleGenerate`), Veo (`handleVeoGenerate`), test-stitch → 9:16 reel
- `true` ← storyboard video (`runStoryboardVideoJob`, `playStoryboardVideo`) and history items where `item.tool === "storyboard_video"` → 16:9 storyboard

The button lives inside the existing `{videoUrl && (...)}` "Final Result" block and renders only when `!resultIsStoryboardFormat`. Storyboard results show the existing Download / Save-to-Gallery affordances but no scheduling button.

### 2. Param contract: `?assetUrl=<url>&title=<theme>` (answer to pre-impl Q1)
- `assetUrl` — `encodeURIComponent(videoUrl)`; the hosted Supabase URL, identical in shape to what `handleAssetSelected` already accepts.
- `title` — `encodeURIComponent(theme)`; the Seedance/Veo theme box value, used to pre-fill the scheduled card's title. Optional: if absent or empty, the title is left blank (current behavior).
- No storyboard warning param is passed (storyboards never reach this button).

Navigation uses a Next.js client navigation (e.g. `Link`/`useRouter().push`) to `/tools/scheduler?...`.

### 3. Scheduler intake is fire-once via a `useRef` flag (answer to pre-impl Q2)
A small reader component calls `useSearchParams()`, reads `assetUrl`/`title`, and on mount:
1. If already consumed (ref flag true) → do nothing.
2. Else set the flag, call `handleAssetSelected(decodeURIComponent(assetUrl))`, and if `title` is present pre-fill the resulting card's title.

The `useRef` guard (not just an empty-deps effect) is required because React StrictMode double-invokes effects in dev, and `handleAssetSelected` is identity-unstable (`useCallback` over `[items, today, updateItem]`); without the guard the asset could be appended twice. The flag is module-instance-scoped to the mounted reader so a genuine fresh navigation with new params still works.

**Title pre-fill mechanism:** `handleAssetSelected` fills the first empty draft or appends a card but does not set a title. Options: (a) extend the intake to locate the just-touched item and `updateItem(id, { title })`, or (b) add an optional `title` parameter to a thin wrapper around `handleAssetSelected`. Prefer (a) — locate by the asset's `videoUrl` after the call — to keep `handleAssetSelected` untouched (it is owned by `schedule-from-assets`). Exact item-id capture is an implementation detail to settle during build (e.g., capture the target id before/after, or derive from the matching `videoUrl`).

### 4. `useSearchParams()` wrapped in `<Suspense>` (answer to pre-impl Q3)
Next.js App Router requires any component calling `useSearchParams()` to be wrapped in a `<Suspense>` boundary, otherwise the whole route opts out of static rendering and the build warns. The intake logic is therefore isolated in a child component rendered inside `<Suspense fallback={null}>` within the scheduler page, keeping the rest of the page render path unchanged.

## Risks / Trade-offs

- **Double-application in StrictMode** → mitigated by the `useRef` consumed-flag (Decision 3).
- **Dynamic rendering of the scheduler route** → expected and acceptable; the route is already a client component with session + interval fetches. Suspense boundary contains the impact.
- **Title pre-fill coupling** → we avoid editing `handleAssetSelected`; the title is applied by the intake layer after the asset is loaded, locating the card by `videoUrl`. If two cards share the same `videoUrl`, the first match is used (acceptable for a one-shot deep link).
- **Stale/extra params after consumption** → the params remain in the URL after a single application; optional polish is to strip them via `router.replace`, but not required for correctness given the fire-once guard.
- **Asset over 60s** → unchanged; the scheduler's existing amber >60s guard applies once duration is read.

## Open Questions

- Whether to `router.replace` the URL to drop the params after consumption (cosmetic; deferred unless it causes confusion on refresh).
- Exact card-id capture for the title pre-fill (settle in implementation; does not affect the spec).
