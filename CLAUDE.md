# Krakatoa Monorepo & AI Tools

## Project Overview
Krakatoa is a premium AI-powered platform tailored for content creators. It features a modern, high-conversion landing page and hosts multiple AI tools under one monorepo. Currently, the flagship application is the **ReelsGen Tool** (`/app/tools/reels`), an autonomous pipeline for creating faceless vertical videos (Reels/TikToks) with dynamic, burned-in styled captions.

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
  - `api/test-stitch/route.ts`: Developer utility for testing Whisper to Rendi stitching pipeline without rerunning generation.
  - `tools/reels/`: The ReelsGen application frontend.
- `lib/`: Shared utility functions (e.g., Supabase client configuration).
- `public/`: Static assets (images, fonts, icons).

## ReelsGen AI Pipeline Architecture
The pipeline in `/app/api/generate/route.ts` runs a complex, automated sequence to produce final burned-in videos.

### 1. Two-Step LLM Cinematography (`meta-llama-3-8b-instruct`)
- **Step 1A (Style Anchoring):** The LLM receives the user's theme and generates a consistent `style_anchor` (e.g., "photorealistic, 9:16 vertical, cinematic lighting") and a `negative_prompt`.
- **Step 1B (Scene Breakdown):** Generates exactly `SCENE_COUNT` scenes (e.g., video prompt, narration). The `style_anchor` is hardcoded to the end of every video prompt to enforce a unified aesthetic across all scenes.

### 2. Parallel Media Generation
- **Video Model:** `bytedance/seedance-2.0-fast` (Receives the negative prompt and video prompt).
- **Voiceover TTS:** `minimax/speech-02-turbo`.
- Media is generated concurrently for all scenes to save time using `Promise.all`. Handles Replicate's `FileOutput` streaming objects properly via `.url()`.

### 3. Audio Transcription
- **Model:** `vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c`.
- **Requirements:** Run sequentially to avoid GPU rate limits. Uses `language: "english"` explicitly to avoid 422 API errors.
- **Parsing:** Parses the `{ chunks: [...] }` response format into word/phrase level timestamps.

### 4. Subtitle Generation (ASS Format)
- Parses Whisper timestamps into an Advanced SubStation Alpha (`.ass`) file format.
- Uses `Math.floor((marginV / 100) * (854 - (fontsize * 1.5)))` to convert the frontend 0-100% MarginV slider into precise vertical pixel offsets compatible with libass/FFmpeg.

### 5. Rendi Cloud Stitching (FFmpeg)
- Avoids local FFmpeg/Vercel timeout limits by using the external **Rendi API**.
- **Multi-Scene Concatenation:** If `SCENE_COUNT > 1`, video concatenation and audio concatenation commands are sent to Rendi sequentially to respect the free tier 1-concurrent-connection limits.
- **Merging & Burning:** A final Rendi command merges the combined video, audio, ASS subtitles, and downloaded remote Google Fonts (`.ttf`) to produce the final `reels_TIMESTAMP.mp4` file.
- **Storage:** Final video is downloaded and uploaded to the Supabase `videos` bucket, and a public URL is returned to the client.

## Developer Guidelines
1. **Design Philosophy**: 
   - Ensure a premium, dark-mode first, glassmorphism aesthetic.
   - Use high-quality typography and dynamic animations (e.g., smooth Tailwind `transition-all`, micro-interactions).
2. **ReelsGen UI Adjustments**: 
   - Maintain the Live Styler Preview. The `bottom: calc(...)` CSS property in the preview must mathematically match the `.ass` generator `maxMarginV` cap to ensure WYSIWYG parity.
3. **API Routing**:
   - For long-running API routes (like generation), ensure the Next.js `maxDuration = 600` is defined and handle any potential polling blockages gracefully.
4. **Environment Variables**:
   - `REPLICATE_API_TOKEN` - Replicate access.
   - `RENDI_API_KEY` - Rendi FFmpeg stitching access.
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase config.
