## Why

ReelsGen today offers two long pipelines (Seedance multi-scene with captions and Veo). Creators who want a **fast, visual-first** path—approve a six-panel storyboard, then get one **15s cinematic clip with native audio**—have no dedicated flow. A Storyboard tab closes that gap by pairing GPT Image 2 (structured board) with GPT-5 (Seedance-ready prompt) and Seedance 2.0 Fast with multimodal reference.

## What Changes

- Add a third engine tab **Storyboard** on the ReelsGen page (`app/tools/reels/page.tsx`) with theme input, storyboard generation, review/regenerate, and video creation with distinct loading states.
- Add **`POST /api/generate-storyboard`**: theme → Replicate `openai/gpt-image-2` → upload PNG to Supabase → `{ storyboardUrl }`.
- Add **`POST /api/generate-storyboard-video`**: theme + `storyboardUrl` → Replicate `openai/gpt-5` (plain-text Seedance prompt) → Replicate `bytedance/seedance-2.0-fast` with `reference_images`, fixed 15s / 720p / 16:9 / `generate_audio: true` → upload MP4 → `{ videoUrl }`.
- Extend storage helpers (or paths) for `videos/storyboard/` assets under the existing `krakatoa` bucket pattern.
- Reuse existing patterns: `getSupabase()`, `STORAGE_BUCKET`, Replicate client + optional 429 retry, URL extraction similar to `extractMediaUrl` in `app/api/generate/route.ts`, process logs and result preview UX.

## Capabilities

### New Capabilities

- `reels-storyboard`: End-to-end Storyboard tab behavior—API contracts, Supabase paths, ReelsGen UI flow (two-step storyboard then video), loading copy, and integration with Seedance reference image mode.

### Modified Capabilities

- _(none — no existing `openspec/specs/` baseline in-repo.)_

## Impact

- **Frontend:** `app/tools/reels/page.tsx` (tab state, conditional controls, handlers, 16:9 preview considerations vs current 9:16-centric player styling).
- **Backend:** New route modules under `app/api/generate-storyboard/` and `app/api/generate-storyboard-video/` (or equivalent `route.ts` paths).
- **Shared:** `lib/storage-buckets.ts` (storyboard path helpers); possible small shared helper for Replicate output URL normalization (optional refactor vs inline copy).
- **Dependencies:** Existing `REPLICATE_API_TOKEN`, Supabase service role + public URLs for inputs Replicate must fetch.
- **Ops:** New routes need `maxDuration` tuned for image + video latency; no change to Product Photo `photos/` isolation rules.

## Implementation Notes (Pre-Apply Review)

- Seedance reference field must use `reference_images` (array of URIs), NOT the `image` field (first frame only)
- GPT Image 2 prompt must explicitly instruct: generate 1 single image containing 6 panels in a grid layout, not 6 separate images
- Video preview player in Storyboard tab must render 16:9 aspect ratio, not 9:16 like Seedance/Veo tabs
- Both new routes must set `maxDuration = 600`
