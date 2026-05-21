## 1. Storage and shared utilities

- [ ] 1.1 Add `videos/storyboard/` path helper(s) in `lib/storage-buckets.ts` (constant segment + `videosStoryboardPath` or equivalent) aligned with existing `VIDEOS_FOLDER` conventions.
- [ ] 1.2 (Optional) Extract or duplicate `extractMediaUrl` (+ optional `runWithRetry`) into a small shared module for `app/api/generate/route.ts` and the new routes, only if it reduces duplication without a large refactor.

## 2. API: Generate storyboard image

- [ ] 2.1 Create `app/api/generate-storyboard/route.ts` with appropriate `maxDuration`, `POST` handler, theme validation, and `Replicate` client using `REPLICATE_API_TOKEN`.
- [ ] 2.2 Implement `openai/gpt-image-2` call using the **exact** input schema from Replicate docs (prompt for 6-panel annotated cinematic storyboard for a 15s video).
- [ ] 2.3 Normalize model output to a fetchable image URL, download buffer, upload to `videos/storyboard/storyboard_<timestamp>.png`, return `{ storyboardUrl }` with consistent error JSON on failure.

## 3. API: Generate storyboard-driven video

- [ ] 3.1 Create `app/api/generate-storyboard-video/route.ts` with `maxDuration` suitable for Seedance 15s + LLM, theme + `storyboardUrl` validation (`https` only).
- [ ] 3.2 Implement `openai/gpt-5` call with system + user instructions: output **only** plain-text Seedance prompt (style, lighting, atmosphere, Indonesian dialogue in quotes, audio/mood, per-scene timestamps); normalize array/object output to a string.
- [ ] 3.3 Call `bytedance/seedance-2.0-fast` with `reference_images: [storyboardUrl]`, fixed params (`duration: 15`, `generate_audio: true`, `resolution: "720p"`, `aspect_ratio: "16:9"`), and prompt referencing **[Image1]** per Seedance docs.
- [ ] 3.4 Resolve video URL via shared/normalized `extractMediaUrl`, upload to `videos/storyboard/video_<timestamp>.mp4`, return `{ videoUrl }`.

## 4. ReelsGen UI

- [ ] 4.1 Extend `engineTab` to include `"storyboard"` and add a third tab button with styling consistent with Seedance/Veo.
- [ ] 4.2 Add state: `storyboardTheme`, `storyboardUrl`, `storyboardLoading`, `videoLoading`; wire theme input and **Generate Storyboard** / **Generate Again** / **Create Video** handlers with `fetch` to the new endpoints.
- [ ] 4.3 Implement loading copy: “Creating your storyboard...” and “Generating video with audio, this may take up to 2 minutes...”; append meaningful lines to existing `logs` array.
- [ ] 4.4 Render storyboard `<img>` when `storyboardUrl` is set; adjust final `<video>` layout for **16:9** when on Storyboard tab (or when showing storyboard-derived result).
- [ ] 4.5 When `engineTab === "storyboard"`, hide irrelevant controls (Seedance/Veo settings, dev test block, optional narrator/caption card) to match the slimmer flow.

## 5. Verification

- [ ] 5.1 Manual test: generate storyboard → regenerate → create video → preview + download; confirm Supabase objects exist under `videos/storyboard/`.
- [ ] 5.2 Run `npm run lint` and fix any new issues in touched files.
