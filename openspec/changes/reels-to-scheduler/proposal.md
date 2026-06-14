## Why

The `schedule-from-assets` change closed half the generate → schedule loop: a creator can now open the scheduler and pick a previously generated video from the "My Assets" tab. But the hand-off is still manual — after generating a reel in ReelsGen, the user must navigate to the scheduler, switch to the Assets tab, find the video they just made, and select it.

This change adds the missing forward link: a one-click **"Schedule to YouTube"** button on the ReelsGen result that deep-links into the scheduler with the just-generated video pre-loaded, reusing the existing `handleAssetSelected` entry point. It turns a multi-step manual round-trip into a single button press.

## What Changes

- Add a **"Schedule to YouTube"** button to the ReelsGen "Final Result" card (`app/(app)/tools/reels/page.tsx`), shown only when a video exists **and** the result is a vertical 9:16 reel.
- **Reel-only gate:** the button appears only when `videoUrl && !resultIsStoryboardFormat`. Storyboard (16:9) results do **not** get the button in this version — the scheduler's UX targets YouTube Shorts (vertical, <60s).
- The button navigates to `/tools/scheduler?assetUrl=<encoded videoUrl>&title=<encoded theme>`.
- **Scheduler deep-link intake:** the scheduler (`app/(app)/tools/scheduler/page.tsx`) reads `assetUrl` (and optional `title`) from the URL on mount and calls the existing `handleAssetSelected(mediaUrl)` to load the asset as a schedulable item; when `title` is present it pre-fills the target card's title.
- **Fire-once guard:** a `useRef` "consumed" flag ensures the param is applied exactly once (no double-append on re-render / React StrictMode double-invoke).
- **Suspense boundary:** the `useSearchParams()` reader is wrapped in `<Suspense>` per Next.js App Router requirements.

## Capabilities

### New Capabilities

- `reels-to-scheduler`: One-click hand-off from a generated reel to the scheduler via a deep link (`?assetUrl=&title=`), pre-loading the asset as a schedulable item and pre-filling the title, gated to vertical reel results only.

### Modified Capabilities

- _(none — `schedule-from-assets` provides the `handleAssetSelected` entry point this builds on; that change is not yet archived into `openspec/specs/`, so there is no spec baseline to amend.)_

## Impact

- **Frontend (ReelsGen):** `app/(app)/tools/reels/page.tsx` — the "Final Result" card gains a "Schedule to YouTube" link/button, gated on `videoUrl && !resultIsStoryboardFormat`, building the deep-link URL from `videoUrl` + `theme`.
- **Frontend (Scheduler):** `app/(app)/tools/scheduler/page.tsx` — a new param-reader (under `<Suspense>`) consumes `?assetUrl`/`?title` once and routes the URL into the existing `handleAssetSelected`; optional title pre-fill on the resulting card.
- **Backend:** none. Reuses `handleAssetSelected`, `GET /api/creations/history` (not needed for the direct hand-off), and `POST /api/posts`.
- **Depends on:** `schedule-from-assets` (provides `handleAssetSelected` and the asset-backed `VideoItem` shape). This change should land after it.
- **Risk:** `useSearchParams()` forces dynamic rendering of the scheduler route and needs a Suspense wrapper; the fire-once guard must be robust against StrictMode. Both are addressed in design.
- **Out of scope:** storyboard (16:9) hand-off; multi-video deep links; passing tags/caption/duration through the URL; any change to scheduling or caption logic.
