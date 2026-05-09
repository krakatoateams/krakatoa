# ReelsGen Developer Guide

## Core Commands
- **Install dependencies**: `npm install`
- **Start development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Run local Whisper test script**: `npx tsx test-whisper.ts`

## Tech Stack & Architecture
- **Framework**: Next.js 14+ (App Router)
- **Styling**: Inline CSS / Custom CSS with empirical WYSIWYG scaling
- **Storage**: Supabase Storage (`temp` bucket for test fixtures, `videos` bucket for final outputs)
- **Transcription**: WhisperX via Replicate (`victor-upmeet/whisperx`)
- **Video Compositing**: Rendi API (`https://api.rendi.dev`) for FFmpeg-based remote rendering

## Pipeline Workflows
The application generates short-form vertical videos (Reels/TikTok/Shorts) with animated subtitles.

### Production Pipeline (`/api/generate`)
1. **Media Generation**: Generates/Fetches video/audio based on the user's Theme (multiple scenes supported).
2. **Transcription**: Runs audio through WhisperX via Replicate for word-level timestamps.
3. **Subtitle Generation (ASS)**: Parses WhisperX output into an Advanced SubStation Alpha (`.ass`) file.
4. **Compositing**: Sends media and `.ass` files to Rendi. Combines streams and attaches standard TTF fonts inside an MKV container to bypass generic system fonts.
5. **Burn-in**: Rendi executes a final FFmpeg pass using `libx264` and the `subtitles` filter to hardcode the text onto the video.
6. **Delivery**: The final `.mp4` is uploaded to Supabase `videos` bucket and served to the user.

### Testing Pipeline (`/api/test-stitch`)
- **Purpose**: Rapidly iterate on subtitle styling (colors, fonts, outlines, margins) without burning Replicate credits on media generation and Whisper transcription.
- **Mechanism**: Pulls static `video.mp4` and `audio.mp3` fixtures from the Supabase `temp` bucket, bypasses Replicate by injecting a mocked timestamp array, generates the ASS file, and immediately calls Rendi.

## Subtitle Styling & WYSIWYG Architecture
Achieving 1:1 pixel parity between the browser's CSS preview box and Rendi's `libass` FFmpeg renderer requires very specific mathematical scaling.

### The Problem
- FFmpeg's `libass` maps its `Fontsize` parameter to the TrueType font's `Ascent + Descent` (typographic line height).
- Browsers map CSS `font-size` to the TrueType font's `unitsPerEm` bounding box.
- As a result, CSS text is almost always drawn visually *larger* than FFmpeg video text at the same numerical size.
- Additionally, `libass` renders the `Outline` stroke based on absolute script pixels, unaffected by the internal font glyph scaling.

### The Solution (Font Metric Mapping)
We decouple font scaling and outline scaling in `page.tsx`:
1. **Font Metric Scale**: `FONT_METRIC_SCALES` maps each supported Google Font to a specific scale factor (e.g., `0.65` for Bangers, `0.86` for Poppins) based on its `unitsPerEm / (Ascent + Descent)` ratio.
2. **Descender Offset Scale**: `DESCENDER_OFFSET_SCALES` dynamically adjusts the CSS `bottom` property to simulate the empty space `libass` reserves for font descenders, ensuring the text baseline aligns perfectly when the Vertical Margin is `0%`.
3. **Outline Scaling**: The CSS `-webkit-text-stroke` uses an absolute multiplier (`* 2`) because CSS applies strokes centrally, whereas ASS `Outline` expands outward.

*If adding new fonts to the system, you must empirically measure or extract its TTF metrics to add its conversion scale to these maps.*
