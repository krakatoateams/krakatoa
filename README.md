# Krakatoa

A premium AI-powered platform for content creators. Krakatoa hosts multiple AI tools under one monorepo behind a modern, high-conversion landing page. The flagship tool is the **Reels Creator** (a subtool of the Video studio) — an autonomous pipeline that turns a single theme into a faceless vertical video (Reels/TikTok) with dynamic, burned-in styled captions, across the **Seedance** and **Veo** engines.

## Features

- **Reels Creator** (`/tools/video` → "Reels Creator") — one text-to-video subtool over two engines (Seedance + Veo):
  - Two-step LLM cinematography: generates a consistent visual `style_anchor` and per-scene prompts/narration.
  - Parallel video + voiceover generation across all scenes (Veo single mode uses the model's native audio).
  - Word-level Whisper transcription burned in as styled `.ass` captions.
  - Cloud FFmpeg stitching via Rendi (no local ffmpeg/Vercel timeouts).
  - Final MP4 stored in Supabase Storage and returned to the client.
- **Live caption styler** with WYSIWYG preview (font, size, primary/highlight/outline colors, vertical margin).
- **Premium dark-mode UI** with glassmorphism, built on Tailwind CSS.
- **Platform foundation & dummy credits** — Phase 1–7 platform tables (`profiles`, `projects`, `jobs`, `job_steps`, `assets`, `asset_relations`, `credit_wallets`, `credit_transactions`, `usage_events`) plus a ledger-backed credit system. Existing profiles each hold 500 dummy credits; new profiles auto-receive 500 via an after-insert trigger. The credit-charged routes (`generate-reels`, `generate-storyboard`, `generate-storyboard-video`) spend credits **before** any provider call and best-effort refund on post-spend failure. See [`CLAUDE.md`](./CLAUDE.md) for the full contract.

## Tech Stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Storage / DB**: Supabase
- **AI provider**: Replicate
  - LLM: `openai/gpt-4o-mini`
  - Video: `bytedance/seedance-2.0-fast`
  - TTS: `minimax/speech-02-turbo`
  - ASR: `vaibhavs10/incredibly-fast-whisper`
- **Video processing**: [Rendi](https://rendi.dev) (cloud FFmpeg)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```bash
REPLICATE_API_TOKEN=your_replicate_token
RENDI_API_KEY=your_rendi_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# DOKU credit checkout (payments)
DOKU_CLIENT_ID=your_doku_client_id
DOKU_SECRET_KEY=your_doku_secret_key
DOKU_ENV=sandbox            # or "production"
# DOKU_API_BASE=             # optional override; defaults by DOKU_ENV
# DOKU_NOTIFICATION_URL=     # optional per-request webhook override (same PATH as Back Office)
```

`DOKU_NOTIFICATION_URL` is handy for local development: set it to your public
tunnel URL (e.g. `https://<id>.trycloudflare.com/api/payments/doku/webhook`) and
every checkout overrides DOKU's Back Office notification URL for that request.
The **path** must match the Notification URL configured on the payment channel in
the DOKU Back Office (only the domain may differ).

DOKU sends payment notifications to `POST /api/payments/doku/webhook` — register
this URL (and the success redirect `/dashboard/settings?tab=credits`) in the DOKU
merchant dashboard. `NEXTAUTH_URL` is reused to build the absolute callback URLs.

Create one **public** Supabase Storage bucket (default name: `krakatoa`, or set `SUPABASE_STORAGE_BUCKET` in `.env.local`). Use top-level folders per feature:

| Folder | Feature |
| --- | --- |
| `videos/` | ReelsGen — `.ass` captions and final `.mp4` files |
| `photos/` | Product Photo — uploads and generated images (separate from `videos/`) |

### 3. Apply database migrations

```bash
npm run db:setup
```

This applies every file in `supabase/migrations/` (currently up to `006_dummy_credits.sql`) — idempotent and safe to re-run. It creates the platform foundation tables, the credit ledger and RPC, and grants 500 dummy credits to every existing profile (and any future profile via an after-insert trigger). Requires `SUPABASE_ACCESS_TOKEN` or `DATABASE_URL` in `.env.local` — see [`scripts/setup-db.mjs`](scripts/setup-db.mjs) for details.

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page, or [http://localhost:3000/tools/video](http://localhost:3000/tools/video) for the Video studio (select "Reels Creator" for the reels pipeline).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint the codebase |
| `npm run db:setup` | Apply every migration in `supabase/migrations/` (idempotent) |

## Project Structure

```
app/
  page.tsx                       # Landing page
  tools/video/                   # Video studio (Reels Creator + other video subtools)
  api/generate-reels/route.ts    # Unified Reels Creator pipeline (Seedance + Veo)
  api/test-stitch/route.ts       # Dev utility for re-running the stitching step
lib/reels-pipeline/             # Shared reels pipeline modules (llm, tts, ass, rendi, storage)
lib/                            # Shared utilities (Supabase client, etc.)
public/                         # Static assets
```

## Pipeline Overview

The `POST /api/generate-reels` endpoint runs the full pipeline:

1. **Style anchor + negative prompt** generated by gpt-4o-mini.
2. **Scene breakdown** — exactly `SCENE_COUNT` scenes, each with the style anchor appended verbatim. Auto-retries up to 3× on bad JSON or wrong scene count.
3. **Parallel media generation** — Seedance for video, MiniMax for voiceover, all scenes concurrent.
4. **Sequential Whisper transcription** for word-level timestamps.
5. **`.ass` subtitle file** built with per-scene time offsets, uploaded to Supabase.
6. **Rendi FFmpeg** — normalizes (fps/scale/SAR), concatenates, merges, and burns subtitles into the final MP4.
7. **Final video** uploaded to Supabase and a public URL returned to the client.

See [`CLAUDE.md`](./CLAUDE.md) for an in-depth architecture description and the rationale behind specific implementation choices (LLM choice, no reference-video chaining, concat input normalization, etc.).

## Documentation

| Topic | Path |
| --- | --- |
| Monorepo & pipelines | [`CLAUDE.md`](./CLAUDE.md) |
| Admin Config v2 (unified panel) | [`docs/admin/admin-config-v2-plan.md`](./docs/admin/admin-config-v2-plan.md) |
| Admin Config v2 (ringkasan ID) | [`docs/admin/admin-config-v2-ringkasan.md`](./docs/admin/admin-config-v2-ringkasan.md) |
| Pricing Config v2 | [`docs/billing/pricing-config-v2-plan.md`](./docs/billing/pricing-config-v2-plan.md) |

## Deployment

Deployable to [Vercel](https://vercel.com) out of the box. Make sure to set the environment variables above in your Vercel project settings.

### Vercel plan limits (`maxDuration`)

Vercel's **Hobby (free) plan hard-caps every Serverless Function at `maxDuration = 300` seconds**. If any route declares a higher value the deploy fails at the function-validation step with:

```
Builder returned invalid maxDuration value for Serverless Function "api/generate-reels".
Serverless Functions must have a maxDuration between 1 and 300 for plan hobby.
```

Because of this, the heavy generation routes — `/api/generate-reels` and `/api/generate-storyboard-video` — are pinned to `maxDuration = 300` (look for the `Vercel Hobby plan caps` comment in each `route.ts`).

**Runtime trade-off:** generations that take longer than 5 minutes will be terminated by the function timeout. Upgrading to the Vercel **Pro** plan raises the ceiling to 800s, at which point these routes can be raised back to `600`. Do not set any route above `300` while the project is on the Hobby plan.
