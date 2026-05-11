# Krakatoa Monorepo & AI Tools

## Project Overview
Krakatoa is a premium AI-powered platform tailored for content creators. It features a modern, high-conversion landing page and hosts multiple AI tools under one monorepo. Currently, the flagship application is the **Reels Generator** (`/app/tools/reels`), an autonomous pipeline for creating vertical videos (Reels/TikToks) with dynamic, burned-in styled captions.

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Language**: TypeScript
- **Storage/Database**: Supabase
- **AI/Model Provider**: Replicate
- **Video Processing**: Rendi API (Cloud FFmpeg)

## Build & Development Commands
- **Install dependencies**: `npm install`
- **Run development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Linting**: `npm run lint`

## Project Structure
- `app/`: Next.js App Router root.
  - `page.tsx`: Main Krakatoa Landing Page.
  - `api/generate/route.ts`: Core AI video generation pipeline endpoint.
  - `api/test-stitch/route.ts`: Developer utility for testing Whisper to Rendi stitching pipeline without rerunning generation (UI section currently hidden).
  - `tools/reels/`: The ReelsGen application frontend.
- `lib/`: Shared utility functions (e.g., Supabase client configuration).
- `public/`: Static assets (images, fonts, icons).

## ReelsGen AI Pipeline Architecture
The pipeline in `/app/api/generate/route.ts` runs a complex, automated sequence to produce final burned-in videos.

### 1. Two-Step LLM Cinematography (`openai/gpt-4o-mini`)
- **Model:** `openai/gpt-4o-mini` via Replicate. Chosen over Llama 3 8B for far more reliable structured JSON output (small models frequently returned the wrong scene count).
- **Step 1A (Style Anchoring):** The LLM receives the user's theme and generates a consistent `style_anchor` (e.g., "photorealistic, 9:16 vertical, cinematic lighting") and a `negative_prompt`.
- **Step 1B (Scene Breakdown):** Generates exactly `SCENE_COUNT` scenes (`scene_id`, `video_prompt`, `narration`, `duration`). The actual `style_anchor` string is interpolated into the system prompt and the LLM is instructed to copy it verbatim at the end of every `video_prompt`.
- **Robust JSON parsing:** A custom `extractJson` helper strips markdown fences and falls back to balanced-bracket scanning (`[...]` or `{...}`) if `JSON.parse` fails. Step 1B retries up to 3 times if the parsed array length doesn't match `SCENE_COUNT`, and tolerates `{ "scenes": [...] }` wrapper objects.
- **Style anchor safety net:** After parsing, every `video_prompt` is post-processed: any literal "the style anchor" placeholder text the LLM hallucinates is stripped, and the real `style_anchor` is appended if missing — guaranteeing the value reaches Seedance.

### 2. Parallel Media Generation
- **Video Model:** `bytedance/seedance-2.0-fast`. Receives the prompt (with `style_anchor` baked in), `negative_prompt`, `aspect_ratio: "9:16"`, duration, and resolution.
- **No reference-video chaining:** Earlier versions chained scenes via `reference_videos` to enforce visual consistency, but this froze motion/camera/composition (the "Photoshop cloth swap" effect). Consistency is now carried entirely by the shared `style_anchor` in every prompt.
- **Voiceover TTS:** `minimax/speech-02-turbo`.
- All video and audio generations run concurrently via `Promise.all([Promise.all(videoPromises), Promise.all(audioPromises)])`. Handles Replicate's `FileOutput` streaming objects via `.url()`.

### 3. Audio Transcription
- **Model:** `vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c`.
- **Requirements:** Run sequentially to avoid GPU rate limits. Uses `language: "english"` explicitly to avoid 422 API errors.
- **Parsing:** Parses the `{ chunks: [...] }` response format into word/phrase level timestamps.

### 4. Subtitle Generation (ASS Format)
- Parses Whisper timestamps into an Advanced SubStation Alpha (`.ass`) file format with per-scene offsets (`index * DURATION_PER_SCENE`).
- Uses `Math.floor((marginV / 100) * (854 - (fontsize * 1.5)))` to convert the frontend 0-100% MarginV slider into precise vertical pixel offsets compatible with libass/FFmpeg.

### 5. Rendi Cloud Stitching (FFmpeg)
- Avoids local FFmpeg/Vercel timeout limits by using the external **Rendi API**.
- **Multi-Scene Concatenation:** If `SCENE_COUNT > 1`, video and audio concatenation are sent to Rendi sequentially (free-tier 1-concurrent-connection limit).
- **Input normalization (CRITICAL):** Before video concatenation, every input stream is normalized via `fps=30`, `scale=W:H:force_original_aspect_ratio=decrease`, `pad`, `setsar=1`, and `format=yuv420p`. Without this, Seedance outputs with mismatched fps/SAR cause the `concat` filter to silently produce broken output where only the first scene plays. The concat output is re-encoded with `libx264 -crf 20 -pix_fmt yuv420p`.
- **Merging:** A Rendi command merges the combined video, combined audio, `.ass` subtitles, and (optionally) an attached Google Font `.ttf` into an intermediate `merged.mkv`.
- **Burning:** A final Rendi command burns subtitles directly from the original `.ass` URL using `-vf "subtitles={{in_srt}}"` (not from the embedded mkv subtitle stream — that path was unreliable for multi-scene videos), producing `final_video.mp4`.
- **Storage:** Final video is downloaded and uploaded to the Supabase `videos` bucket, and a public URL is returned to the client.

## Developer Guidelines
1. **Design Philosophy**:
   - Ensure a premium, dark-mode first, glassmorphism aesthetic.
   - Use high-quality typography and dynamic animations (e.g., smooth Tailwind `transition-all`, micro-interactions).
2. **ReelsGen UI Adjustments**:
   - Maintain the Live Caption Preview. The `bottom: calc(...)` CSS property in the preview must mathematically match the `.ass` generator `maxMarginV` cap to ensure WYSIWYG parity.
3. **API Routing**:
   - For long-running API routes (like generation), ensure the Next.js `maxDuration = 600` is defined and handle any potential polling blockages gracefully.
4. **LLM Prompts**:
   - When asking the LLM to reuse a value (like `style_anchor`), ALWAYS interpolate the actual string into the system prompt and add a programmatic safety net post-parse. Never rely on phrasing like "the provided X" — small/medium models will copy that phrase literally.
5. **FFmpeg concat**:
   - Always normalize fps/scale/SAR/pixel-format before the `concat` filter when inputs come from generative video models. Mismatches fail silently.
6. **Environment Variables**:
   - `REPLICATE_API_TOKEN` - Replicate access (used for gpt-4o-mini, Seedance, MiniMax TTS, and Whisper).
   - `RENDI_API_KEY` - Rendi FFmpeg stitching access.
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase config.

## Team & Collaboration Workflow
### Roles
- **Project Lead (@lead)**: Reviews everything, specifically core files and API.
- **Product Photo (@tim-photo)**: Owner of `/app/tools/photo/`.
- **Scheduler (@tim-scheduler)**: Owner of `/app/tools/scheduler/`.

### Branch Strategy
- `main`: Production.
- `dev`: Integration.
- `feature/[tool]-[name]`: Individual features (e.g., `feature/reels-fx`).
- Always branch from `dev`.

### GitHub configuration
- `.github/CODEOWNERS`: Automated review assignments.
- `.github/pull_request_template.md`: Required PR format.
- `.github/workflows/ci.yml`: CI Check (build test) on PRs to `dev` or `main`.
- `CONTRIBUTING.md`: Full workflow documentation.
