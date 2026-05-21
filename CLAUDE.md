# Krakatoa Monorepo & AI Tools

## Project Overview
Krakatoa is a premium AI-powered platform tailored for content creators. It features a modern, high-conversion landing page and hosts multiple AI tools under one monorepo. Flagship tools include **ReelsGen** (`app/(app)/tools/reels/page.tsx`, URL `/tools/reels`), an autonomous pipeline for vertical videos (Reels/TikToks) with burned-in styled captions; **Product Photo** (`app/(app)/tools/photo/page.tsx`); **Scheduler** (`app/(app)/tools/scheduler/`) with Google Calendar/YouTube integrations; and **IG** (`app/(app)/tools/ig/page.tsx`).

## Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Language**: TypeScript
- **Storage/Database**: Supabase (Storage + Postgres where used)
- **Auth**: NextAuth.js (Google provider) for scheduler/dashboard flows
- **AI/Model Provider**: Replicate
- **Google APIs**: `googleapis` (OAuth, Calendar, YouTube) where scheduler features need them
- **Video Processing**: Rendi API (Cloud FFmpeg)

## Build & Development Commands
- **Install dependencies**: `npm install`
- **Run development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Linting**: `npm run lint`

## Project Structure
- `app/`: Next.js App Router root.
  - `page.tsx`: Main Krakatoa landing page.
  - `dashboard/`: Authenticated hub (uses NextAuth + Supabase patterns as implemented).
  - `api/generate/route.ts`: Core ReelsGen AI video generation pipeline (`maxDuration = 600`).
  - `api/test-stitch/route.ts`: Developer utility to test Whisper → Rendi stitching from existing Replicate prediction IDs (`maxDuration = 300`).
  - `api/generate-photo/route.ts`: Product Photo generation.
  - `api/generate-caption/route.ts`: Short-form caption helper (Llama 3 8B on Replicate).
  - `api/auth/[...nextauth]/route.ts`: NextAuth handler.
  - `api/cron/route.ts`, `api/posts/`, `api/product-photo/`: Scheduling and product-photo support routes.
  - `api/upload/route.ts`: MP4 upload endpoint (verify bucket/path against your Supabase setup).
  - `tools/reels/`: ReelsGen frontend.
  - `tools/photo/`: Product Photo frontend.
  - `tools/scheduler/`, `tools/scheduler/calendar/`: Scheduler UI.
  - `tools/ig/`: Instagram-related tool surface.
- `lib/`: Shared utilities (`supabase.ts`, `supabase-server.ts`, `storage-buckets.ts`, `auth.ts`, `youtube.ts`, etc.).
- `public/`: Static assets (images, fonts, icons).

## ReelsGen AI Pipeline Architecture
The pipeline in `app/api/generate/route.ts` orchestrates LLM scripting, one continuous voiceover, transcription, parallel scene video generation, ASS subtitles, Rendi stitching, and Supabase upload of the final MP4.

### 1. Two-Step LLM (`google/gemini-2.5-flash` on Replicate)
- **Model:** `google/gemini-2.5-flash` via Replicate for strong creative copy and structured JSON.
- **Step 1A (Style + narrator mood):** Returns JSON with `style_anchor`, `negative_prompt`, and `narrator_emotion` (values aligned with MiniMax `speech-02-turbo`). Uses `thinking_budget: 0` on this call.
- **Step 1B (Scene breakdown):** Returns exactly `SCENE_COUNT` scenes (`scene_id`, `video_prompt`, `narration`). Narrations are written as **one continuous story** split per scene so a **single** TTS call reads naturally. The literal `style_anchor` string is embedded in the system prompt; every `video_prompt` must end with that string copied verbatim. This step uses `dynamic_thinking: true` on Replicate.
- **Robust JSON parsing:** `extractJson` strips markdown fences and falls back to balanced-bracket scanning. Step 1B retries up to 3 times if the parsed scene count is wrong; accepts `{ "scenes": [...] }` wrappers.
- **Safety nets:** Strip hallucinated “the style anchor” phrasing; append the real `style_anchor` if missing from a prompt. Hard-truncate each scene’s narration to a word cap derived from `DURATION_PER_SCENE` (~1.7 words/sec) to stay within Seedance-friendly length; residual timing is handled by TTS speed retry + FFmpeg `atempo`.

### 2. Voiceover, Timing, and Scene Video
- **Single TTS pass:** `minimax/speech-02-turbo` speaks the **full** narration (all scenes joined) with `voice_id`, `emotion`, configurable `speed`, and English language boost.
- **TTS duration fitting:** Whisper measures the first TTS pass; if duration vs. `TOTAL_DURATION` is outside ~±15%, TTS re-runs with a corrected `speed` (clamped to MiniMax’s supported range). FFmpeg `atempo` on merge applies a final speed factor so the mixed audio lands on exactly `TOTAL_DURATION` seconds.
- **Whisper:** `vaibhavs10/incredibly-fast-whisper` with `language: "english"`, `timestamp: "word"`. Runs inside the same step as each TTS attempt (not parallel with Seedance).
- **Video model:** `bytedance/seedance-2.0-fast` per scene — `aspect_ratio: "9:16"`, user `resolution`, `duration: DURATION_PER_SCENE`, `generate_audio: false`, shared `negative_prompt`, prompts ending with `style_anchor`.
- **No reference-video chaining:** Visual consistency comes from the repeated `style_anchor` in every scene prompt (reference chaining was removed to avoid frozen composition).
- **Parallelism:** After TTS+Whisper is finalized, **all scene videos** are requested in parallel via `Promise.all` over Seedance calls. Replicate `FileOutput`-style objects are normalized through a shared `extractMediaUrl` helper (supports `.url()`, strings, arrays, etc.).

### 3. Subtitles (ASS)
- Word-level timestamps from Whisper are written to **Advanced SubStation Alpha** (`.ass`).
- Timestamps are scaled by the final `audioSpeedFactor` (`atempo`) so on-screen text matches time-stretched audio.
- **MarginV:** `Math.floor((marginV / 100) * (854 - (fontsize * 1.5)))` for 480×854 base (720p uses parallel target height in the Rendi filter graph). Must stay in sync with the ReelsGen live caption preview CSS (`bottom: calc(...)`) for WYSIWYG.

### 4. Rendi Cloud Stitching (FFmpeg)
- Avoids local FFmpeg / Vercel timeout limits via **Rendi** (`https://api.rendi.dev/v1/run-ffmpeg-command`).
- **Per-scene normalization:** `tpad` + `trim` to exact per-scene duration, then `fps=30`, `scale` + `pad`, `setsar=1`, `format=yuv420p` before `concat` — **required** so Seedance outputs with mismatched fps/SAR do not break multi-scene concatenation.
- **Multi-scene:** Concatenate normalized streams; re-encode with `libx264 -crf 20 -pix_fmt yuv420p`.
- **Audio on merge:** `apad`, optional `atempo`, `atrim` to exact `TOTAL_DURATION`, `asetpts` so audio matches the trimmed/padded video timeline.
- **Merge:** Combined video + TTS audio + `.ass` + optional Google Font TTF (remote font URLs pinned to a specific `google/fonts` commit in code for stable TTF paths) → `merged.mkv`.
- **Burn-in:** Final pass burns subtitles from the **hosted `.ass` URL** via `-vf "subtitles={{in_srt}}"` (not only the MKV subtitle stream), outputting `final_video.mp4`.

### 5. Supabase Storage (ReelsGen)
- **Canonical paths:** `lib/storage-buckets.ts` — bucket name `STORAGE_BUCKET` from `SUPABASE_STORAGE_BUCKET` or default **`krakatoa`**.
- **Final deliverable:** `videos/reels_<timestamp>.mp4` — public URL returned as `videoUrl` to the client for preview and download.
- **Transient captions:** `.ass` uploaded to **`videos/temp/captions_<timestamp>.ass`** for Rendi to fetch; deleted after a successful run.
- **Product Photo** uses **`photos/`** in the same bucket — never under `videos/`.

## Developer Guidelines
1. **Design philosophy:** Premium, dark-first, glassmorphism; smooth Tailwind transitions and micro-interactions.
2. **ReelsGen UI:** Keep Live Caption Preview math aligned with the ASS `maxMarginV` / margin logic in `app/api/generate/route.ts`.
3. **Long-running routes:** `maxDuration` is set on `generate` and `test-stitch`; handle Rendi polling timeouts gracefully.
4. **LLM prompts:** Always interpolate concrete strings (e.g. `style_anchor`) into prompts; never rely on “the provided X” placeholders — add post-parse safety nets.
5. **FFmpeg concat:** Always normalize fps/scale/SAR/pixel format before `concat` when inputs come from generative video models.
6. **Environment variables (common):**
   - `REPLICATE_API_TOKEN` — Replicate (Gemini, Seedance, MiniMax TTS, Whisper, caption model).
   - `RENDI_API_KEY` — Rendi FFmpeg API.
   - `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Public anon key if you use a browser Supabase client (see `README.md`); server pipelines here rely on the service role for Storage.
   - `SUPABASE_SERVICE_ROLE_KEY` — Server-side Storage/DB (used by generation routes and server helpers).
   - `SUPABASE_STORAGE_BUCKET` — Optional override for the public Storage bucket name (default `krakatoa`).
   - `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — NextAuth session security and canonical site URL.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (scheduler / YouTube flows).
   - `CRON_SECRET` — Protects `app/api/cron` if used.
