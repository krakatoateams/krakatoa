# Krakatoa Monorepo & AI Tools

## Project Overview
Krakatoa is a premium AI-powered platform tailored for content creators. It features a modern, high-conversion landing page and hosts multiple AI tools under one monorepo. Flagship tools include the **Reels Creator** (a subtool of the Video studio at `app/(app)/tools/video/page.tsx`, URL `/tools/video`), an autonomous pipeline for vertical videos (Reels/TikToks) with burned-in styled captions across the Seedance and Veo engines; **Product Photo** (`app/(app)/tools/photo/page.tsx`); **Scheduler** (`app/(app)/tools/scheduler/`) with Google Calendar/YouTube integrations; and **IG** (`app/(app)/tools/ig/page.tsx`).

The platform foundation (profiles, projects, jobs, job_steps, assets, asset_relations, posts platform linkage, credit_wallets, credit_transactions, usage_events) is complete (Phase 1–7). The Dummy Credit Integration is live for internal testing — every existing profile holds 500 dummy credits and the four credit-charged generation routes spend/refund through the ledger RPC before any provider call. No payment gateway/Xendit/subscription system is wired yet.

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
- **Regenerate PWA icons** (from `public/Logo White transparent.svg`): `npm run icons:generate`
- **Apply DB migrations**: `npm run db:setup` (applies every file in `supabase/migrations/` against the project — idempotent and safe to re-run)
- **Migrate storage layout** (one-off path moves): `npm run storage:migrate-layout` (dry-run) / `npm run storage:migrate-layout -- --execute`
- **Migrate to user-first paths** (`photos|videos/{userId}` → `{userId}/photos|videos`): `npm run storage:migrate-user-first` (dry-run, scans DB + storage) / `npm run storage:migrate-user-first -- --execute` / optional `--prune-stale-db` `--delete-global-temp`
- **List storage orphans** (`videos/` + `photos/`): `npm run storage:list-orphans` (optional `--min-age-hours=0`, `--json`, `--include-young`)
- **Verify signed-URL caching** (egress guard): `npm run probe:signed-url-cache`

## Project Structure
- `app/`: Next.js App Router root.
  - `page.tsx`: Main Krakatoa landing page.
  - `dashboard/`: Authenticated hub (uses NextAuth + Supabase patterns as implemented).
  - `api/generate-reels/route.ts`: Unified Reels Creator AI video pipeline — dispatches by engine (`seedance` | `veo`) and Veo mode (`single` | `perScene`) over the shared `lib/reels-pipeline/` modules (`maxDuration = 300`). Replaces the legacy `api/generate` (Seedance) + `api/generate-veo` (Veo) routes.
  - `api/test-stitch/route.ts`: Developer utility to test Whisper → Rendi stitching from existing Replicate prediction IDs (`maxDuration = 300`).
  - `api/generate-photo/route.ts`: Product Photo generation.
  - `api/generate-caption/route.ts`: Short-form caption helper (Llama 3 8B on Replicate).
  - `api/auth/[...nextauth]/route.ts`: NextAuth handler.
  - `api/cron/route.ts`, `api/posts/`, `api/product-photo/`: Scheduling and product-photo support routes.
  - `api/upload/route.ts`: MP4 upload endpoint (verify bucket/path against your Supabase setup).
  - `tools/video/`: Video studio frontend — hosts the **Reels Creator** subtool (Seedance + Veo) plus Text-to-Video, Motion Control, and Storyboard-to-Video.
  - `tools/photo/`: Product Photo frontend.
  - `tools/scheduler/`, `tools/scheduler/calendar/`: Scheduler UI.
  - `tools/ig/`: Instagram-related tool surface.
- `lib/`: Shared utilities (`supabase.ts`, `supabase-server.ts`, `storage-buckets.ts`, `auth.ts`, `youtube.ts`, etc.).
  - **Reels Creator pipeline**: `reels-models.ts` (engine/schema registry + `validateReelsRequest`), `reels-pipeline/` (shared `llm`, `tts-whisper`, `ass`, `rendi-stitch`, `storage`, `seedance`, `veo`, `types`).
  - **Platform/credits**: `profiles-db.ts`, `projects-db.ts`, `jobs-db.ts`, `job-steps-db.ts`, `assets-db.ts`, `asset-relations-db.ts`, `credits-db.ts`, `usage-events-db.ts`, `credit-costs.ts`.
- `supabase/migrations/`: Idempotent, additive SQL migrations applied by `npm run db:setup` (currently up to `060_signed_url_cache.sql`).
- `public/`: Static assets (images, fonts, icons).
  - **PWA**: `public/icons/` (16–512px + maskable + apple-touch), `public/sw.js` (minimal install SW), source logo `Logo White transparent.svg`. Next.js serves `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`, and `app/manifest.ts` → `/manifest.webmanifest`. Regenerate with `npm run icons:generate`.

## Platform Foundation & Credits
Krakatoa's product identity, observability, and billing primitives live in seven Postgres tables that all in-scope generation routes read/write through typed helpers in `lib/`. Ownership boundary is `profile_id`; server routes use the service role and enforce ownership in application code (RLS is enabled on every table as deny-by-default).

### Tables (live)
- **profiles** — Krakatoa product identity (1:1 with NextAuth `users` via `user_id`).
- **projects** — generic container for user work.
- **jobs** — every generation job (queued / running / succeeded / failed / cancelled), with `cost_credits` as a display snapshot.
- **job_steps** — queryable pipeline-step diary attached to a job.
- **assets** — long-term source of truth for generated files (image, video, audio, subtitle, ...). Carries `cost_credits` as a display snapshot.
- **asset_relations** — flexible parent/child links (`derived_from`, `thumbnail_of`, `caption_for`, `audio_for`, `storyboard_for`, `source_for`, `variant_of`, `contains`).
- **posts** — evolved with `profile_id`, `project_id`, `asset_id` platform columns; existing scheduler columns intact.
- **credit_wallets** — fast-read balance cache per profile.
- **credit_transactions** — append-mostly ledger (`purchase`/`spend`/`refund`/`bonus`/`adjustment`/`expiry`); idempotent via `idempotency_key`. **Billing source of truth.**
- **usage_events** — analytics-only provider/model usage records. Never affects balance.

### Migrations (in apply order)
- `003_platform_foundation_nextauth_single_user.sql` — profiles, projects, jobs, job_steps, assets, asset_relations, posts evolution.
- `004_credits.sql` — credit_wallets, credit_transactions, usage_events, and the transactional + idempotent RPC `krakatoa_apply_credit_transaction`.
- `005_user_creations_unique_storage_path.sql` — unrelated dedupe index (kept here for completeness; not part of the credit pipeline).
- `006_dummy_credits.sql` — backfills 500 dummy credits per existing profile via the ledger RPC (idempotency key `seed:initial_500:{profile_id}`), plus the after-insert trigger `profiles_seed_initial_credits` so future profiles auto-receive 500.

### Credit pricing (current dummy values)
Centralized in [`lib/credit-costs.ts`](lib/credit-costs.ts) — never hardcode credit numbers in routes.

| Tool / route | Cost rule |
|---|---|
| Reels Creator / Seedance (`api/generate-reels`, engine `seedance`) | `estimateSeedanceCredits({ sceneCount, durationPerScene })` — 2 credits/sec of total video |
| Reels Creator / Veo single (`api/generate-reels`, engine `veo` mode `single`) | `estimateVeoCredits({ durationSec })` — 8 s = 16, 6 s = 12, 4 s = 8 |
| Reels Creator / Veo per-scene (`api/generate-reels`, engine `veo` mode `perScene`) | `estimateVeoCredits({ durationSec: sceneCount × durationPerScene })` |
| Storyboard image (`api/generate-storyboard`) | fixed 2 credits |
| Storyboard video (`api/generate-storyboard-video`) | fixed 30 credits |
| Photo Studio (`api/generate-photo`) | `productPhotoPricingKey` via pricing resolver (tier + resolution) |

### Spend / refund contract (applies to every charged route)
1. Validate input → strictly resolve profile (no free fallback; non-auth failure = 500).
2. `createJob` + `startJob`.
3. **`spendCredits` BEFORE any provider call.** Idempotency key `spend:{jobType}:{jobId}` (e.g. `spend:reels_seedance:{jobId}`, `spend:veo_single:{jobId}`, `spend:veo_perscene:{jobId}`, `spend:storyboard_image:{jobId}`, `spend:storyboard_video:{jobId}`).
4. On `InsufficientCreditsError`: mark the job `failed` with `error.code='INSUFFICIENT_CREDITS'` and return **HTTP 402** with `{ error, requiredCredits, currentBalance }`. No processing asset, no provider call.
5. On any other spend exception: bubble to outer catch as 500; `creditsSpent` stays `false` → no refund.
6. On success: `createProcessingAsset`, then provider calls, then `markAssetReady` / `finishJob` with `costCredits` snapshot, then safe-wrapped `recordUsageEvent`.
7. On post-spend failure: best-effort `refundCredits` (safe-wrapped, with idempotency key `refund:{jobType}:{jobId}`). A refund failure must never mask the original generation error.

`credit_transactions` is the billing source of truth. `jobs.cost_credits` and `assets.cost_credits` are display snapshots only. `usage_events` is analytics-only and must never affect billing/response.

### Generation cancel (in-flight v1)
Metered routes honor user cancel via `POST /api/generations/cancel` + `lib/generation-cancel.ts` (`cancel_requested`, `generation_predictions`, `cancel_allowed`, `assertNotCancelled`). The generate route owns refund + `cancelJob`; cancel endpoint never refunds in-flight attempts. After provider output is committed (`markProviderCommitted` in `lib/generation-commit.ts` flips `cancel_allowed=false`), cancel API returns 409 `CANCEL_NOT_ALLOWED` and post-commit user cancel does not refund. Recoverable jobs (`pipeline-recovery/`, status `recoverable`): credits held for **Try again**; refund only on genuine delivery failure (`lib/pipeline-recovery/refund-policy-pure.ts` — resume exhausted, terminal resume error, TTL after at least one resume attempt). Abandon recoverable (`cancel` + `jobId`) does not refund. Commit points: first Reels scene / Veo clip, video/image generation success, storyboard import vision LLM. Client: `useIdempotentSubmit().cancel()` + `useGenerationStatusPoll` + `GenerationCancelButton` (shows “Finalizing…” when locked). Stuck runs: `GET /api/cron/generation-reconcile`. Plans: [`docs/generation/generation-cancel-hardening-plan.md`](docs/generation/generation-cancel-hardening-plan.md), [`docs/generation/no-refund-after-replicate-plan.md`](docs/generation/no-refund-after-replicate-plan.md).

### Known limitations (intentional)
- No Xendit / payment gateway / subscription plans yet.
- No credit-balance UI yet.
- Client/request-level idempotency is not implemented — a full HTTP retry produces a new `jobId` and therefore a new spend key (double-charge risk on retries is accepted for this phase).
- `rls_auto_enable` review remains a separate backlog item; routes rely on the service role and enforce `profile_id` ownership in application code.

## Reels Creator AI Pipeline Architecture
The unified route `app/api/generate-reels/route.ts` owns the cross-cutting contract (profile, tool gate, idempotency, spend/refund, jobs/assets, history) and dispatches by engine/mode into `lib/reels-pipeline/` (`runSeedancePipeline`, `runVeoSinglePipeline`, `runVeoPerScenePipeline`). The Seedance pipeline below orchestrates LLM scripting, one continuous voiceover, transcription, parallel scene video generation, ASS subtitles, Rendi stitching, and Supabase upload of the final MP4. The Veo pipelines reuse the same shared modules — Veo `single` uses the model's native audio (extract → Whisper → burn-in); Veo `perScene` runs Seedance-style continuous TTS mapped onto the concatenated timeline.

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
- **MarginV:** `Math.floor((marginV / 100) * (854 - (fontsize * 1.5)))` for 480×854 base (720p uses parallel target height in the Rendi filter graph). Must stay in sync with the Reels Creator live caption preview CSS (`bottom: calc(...)` in `app/(app)/tools/video/page.tsx`) for WYSIWYG. Implemented in `lib/reels-pipeline/ass.ts`.

### 4. Rendi Cloud Stitching (FFmpeg)
- Avoids local FFmpeg / Vercel timeout limits via **Rendi** (`https://api.rendi.dev/v1/run-ffmpeg-command`).
- **Per-scene normalization:** `tpad` + `trim` to exact per-scene duration, then `fps=30`, `scale` + `pad`, `setsar=1`, `format=yuv420p` before `concat` — **required** so Seedance outputs with mismatched fps/SAR do not break multi-scene concatenation.
- **Multi-scene:** Concatenate normalized streams; re-encode with `libx264 -crf 20 -pix_fmt yuv420p`.
- **Audio on merge:** `apad`, optional `atempo`, `atrim` to exact `TOTAL_DURATION`, `asetpts` so audio matches the trimmed/padded video timeline.
- **Merge:** Combined video + TTS audio + `.ass` + optional Google Font TTF (remote font URLs pinned to a specific `google/fonts` commit in code for stable TTF paths) → `merged.mkv`.
- **Burn-in:** Final pass burns subtitles from the **hosted `.ass` URL** via `-vf "subtitles={{in_srt}}"` (not only the MKV subtitle stream), outputting `final_video.mp4`.

### 5. Supabase Storage (Reels Creator)
- **Canonical paths:** User media is scoped under `{userId}/` first. Video studio: `{userId}/videos/generated/video/{mode}/` (`reelscreator`, `t2v`, `i2v`, `motion-control`). Storyboard i2v: `{userId}/videos/generated/storyboard/`. Photo studio: `{userId}/photos/generated/{mode}/` (`product`, `t2i`, `character`, `storyboard`). Photo reference uploads: `{userId}/photos/uploads/reference/`. Transient video refs: `{userId}/videos/temp/`. **Pipeline recovery staging:** `{userId}/resumable/{jobId}/` (outside `photos/` and `videos/`; auto-purged on success/terminal/TTL). Legacy `photos|videos/{userId}/…` paths remain readable until `npm run storage:migrate-user-first -- --execute`.
- **Final deliverable (Reels Creator):** `{userId}/videos/generated/video/reelscreator/video_<timestamp>.mp4` (Seedance and Veo share this folder).
- **Recovery captions/scenes:** Reels recovery uploads `.ass` and scene MP4s under `{userId}/resumable/{jobId}/` (not `videos/temp/`). Legacy runs still use `{userId}/videos/temp/` for captions only.
- **Product Photo** uses **`{userId}/photos/`** in the same bucket — never under `videos/`.
- **Hygiene:** `lib/storage-orphan-audit.ts` audits both roots (includes `assets` refs). `npm run storage:list-orphans` lists deletable orphans; `GET /api/cron/storage-sweep` deletes `videos/` only (daily cron).
- **Private access (live):** `lib/storage-signed-url.ts` + `GET /api/storage/sign` mint ownership-checked signed URLs. Generation routes store `storage_path` in DB; list APIs and `useSignedMediaUrl` sign on read. Bucket `krakatoa` is **private** (migration `049_storage_bucket_private.sql`). Legacy `/api/upload` returns 410 — use `POST /api/upload/sign`.

## Supabase egress (free plan — 5 GB uncached + 5 GB cached per month)

**Status: fixed and verified Aug 11, 2026.** The project was throttled last month for blowing the quota. Root cause was *not* volume (202 MB stored, 7 jobs in 14 days) — it was **signed URLs whose token changed on every call**. A new URL is a new cache entry, so the browser had no ETag to revalidate and re-downloaded the whole file on every page view. Supabase does answer a conditional GET with **304 / 0 bytes**, so stable URLs make repeat views free.

Rules for new code:

1. **Never sign the same object twice with a fresh token for UI reads.** `createSignedStorageUrl` caches `ui`-TTL URLs in the `signed_url_cache` table (migration `060`) so the URL is identical across requests and instances. Only the `ui` TTL is cached, matched **exactly** — `ttl` arrives from a query param, so a range would let any caller mint unbounded cache rows. `pipeline` and `publish` stay short and uncached on purpose.
2. `SIGN_TTL.ui` is **30 days**. Any client-side `setTimeout` derived from it must be clamped — past ~24.8 days the delay overflows int32 and fires immediately (see `MAX_REFRESH_MS` in `lib/use-signed-media-url.ts`).
3. **Never render user media with `unoptimized` on `next/image`.** A 2.42 MB source PNG becomes 20 KB of WebP at grid size. `next.config.mjs` allows `/object/sign/**` with `minimumCacheTTL` 30 days.
4. Upload with `MEDIA_CACHE_CONTROL` from `lib/storage-buckets.ts`, never a literal `"3600"`. Exception: upserted recovery staging paths.
5. `storage.objects.metadata->>'cacheControl'` is **not** what Supabase serves — the header comes from S3 object metadata. Editing that jsonb does nothing.

Check: `npm run probe:signed-url-cache`. Full write-up incl. measurements and what was ruled out: [`docs/ops/supabase-egress.md`](docs/ops/supabase-egress.md).

## Admin Config v2 (unified control panel)

**Status:** Cutover complete. Photo + Video mode matrices and per-model catalog on/off persist via `feature_model_configs` and `model_catalog_configs`.

| Doc | Purpose |
|-----|---------|
| [`docs/admin/admin-config-v2-plan.md`](docs/admin/admin-config-v2-plan.md) | Authoritative plan for agents (architecture, phases, parity checklist) |
| [`docs/admin/admin-config-v2-ringkasan.md`](docs/admin/admin-config-v2-ringkasan.md) | Indonesian summary |
| [`openspec/changes/admin-config-v2-unified/`](openspec/changes/admin-config-v2-unified/) | OpenSpec change (proposal, design, tasks, spec) |

Key code: `lib/admin-config-tree.ts`, `lib/video-composer-features.ts`, `lib/model-catalog-configs.ts`, `lib/admin-pipeline-config.ts`, `app/(app)/admin/config-v2/page.tsx`.

## Admin Monitoring (`/admin/monitoring`)

**Status: verified against the live DB and in the UI (Aug 11, 2026).** Migration `057` (read-perf indexes) is applied, `npm run admin:probe-monitoring` passes, and the panel renders real data. Only the cancel/failure scenarios that need a real generation are still outstanding. The first UI pass caught a route bug — an absent `limit` query param parsed as `0` and became `.limit(0)`, so the panel was always empty despite the probe passing; probe covers the query layer, not query-string parsing.

Read-only cross-user generation monitor: who is generating what, which pipeline step they're on, and three derived anomalies — `stuck`, `cancel_not_honored`, `refund_missing`. Adds **no tables/columns**; it joins `jobs`, `job_steps`, `credit_transactions`, `generation_requests`, `generation_predictions` and `jobs.output.recovery`.

Key code: `lib/admin-monitoring-flags.ts` (pure classifier + self-check), `lib/admin-monitoring-db.ts` (batched queries — 5 round trips, never N+1), `app/api/admin/monitoring/`, `app/(app)/admin/monitoring/page.tsx`.

**Prompt capture (Aug 11, 2026):** `generate-video` and `generate-photo` now persist the user's prompt to `jobs.input.prompt`, and photo records the assembled prompt on the `image_generation` step (it is built after `createJob`). New generation routes should follow the same convention — user prompt on the job, assembled prompt on the step that calls the model — and the monitoring detail picks it up with no UI change. System instructions stay unstored: the template is a constant in `lib/reels-pipeline/llm.ts` and its only per-run parts (`styleAnchor`, `maxWordsPerScene`) are already on the steps.

**Refund rule delegates to `shouldRefundRecoverableTerminal()`** in `lib/pipeline-recovery/refund-policy-pure.ts` — never restate refund policy in the monitoring module; add new terminal error codes to `RECOVERABLE_TERMINAL_CODES` or they surface as false positives.

Checks: `npm run test:monitoring-flags` (no DB needed), `npm run admin:probe-monitoring` (needs a live DB). Historical baseline over 30 days is all zeros. The one `refund_missing` it originally surfaced was a genuine pre-fix bug (not a false positive) and was settled on Aug 11, 2026 by replaying the canonical `refund:{jobType}:{jobId}` key through the ledger RPC — corrections must be `type='refund'` with `job_id` set, since an `adjustment` fixes the balance without clearing the flag. Full doc incl. the remaining E2E checklist: [`docs/admin/admin-monitoring.md`](docs/admin/admin-monitoring.md).

## Developer Guidelines
1. **Design philosophy:** Premium, dark-first, glassmorphism; smooth Tailwind transitions and micro-interactions.
2. **Reels Creator UI:** Keep the Live Caption Preview math (in the Reels Creator composer inside `app/(app)/tools/video/page.tsx`) aligned with the ASS `maxMarginV` / margin logic in `lib/reels-pipeline/ass.ts`.
3. **Long-running routes & Vercel plan limits:** `maxDuration` is set on the heavy routes; handle Rendi polling timeouts gracefully. **Vercel's Hobby (free) plan hard-caps every Serverless Function at `maxDuration = 300` seconds** (deployment fails outright with `Builder returned invalid maxDuration value ... must have a maxDuration between 1 and 300 for plan hobby` if a route exceeds it). All heavy routes (`api/generate-reels`, `api/generate-storyboard-video`) are therefore pinned to `300`. **Trade-off:** real generations that run longer than 5 minutes will be killed by Vercel's function timeout at runtime. The Pro plan raises the ceiling to 800s — if/when upgraded, these routes can be raised back to `600` (search the codebase for the `Vercel Hobby plan caps` comments). Never set a route above `300` while the project is on Hobby.
4. **LLM prompts:** Always interpolate concrete strings (e.g. `style_anchor`) into prompts; never rely on “the provided X” placeholders — add post-parse safety nets.
5. **FFmpeg concat:** Always normalize fps/scale/SAR/pixel format before `concat` when inputs come from generative video models.
6. **Environment variables (common):**
   - `REPLICATE_API_TOKEN` — Replicate (Gemini, Seedance, MiniMax TTS, Whisper, caption model).
   - `RENDI_API_KEY` — Rendi FFmpeg API.
   - `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Public anon key if you use a browser Supabase client (see `README.md`); server pipelines here rely on the service role for Storage.
   - `SUPABASE_SERVICE_ROLE_KEY` — Server-side Storage/DB (used by generation routes and server helpers).
   - `SUPABASE_STORAGE_BUCKET` — Optional override for the Storage bucket name (default `krakatoa`, private).
   - `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — NextAuth session security and canonical site URL.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth (scheduler / YouTube flows).
   - `CRON_SECRET` — Bearer token untuk semua `GET /api/cron/*` (lihat [`docs/ops/cron-jobs.md`](docs/ops/cron-jobs.md)).
 - `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY` — DOKU Checkout credentials (credit purchases).
 - `DOKU_ENV` — `sandbox` (default) or `production`; selects the DOKU API base URL.
 - `DOKU_API_BASE` — Optional explicit DOKU API base URL override (otherwise derived from `DOKU_ENV`).
 - `DOKU_NOTIFICATION_URL` — Optional per-request webhook override (`additional_info.override_notification_url`). Path must match the Back Office Notification URL; only the domain may differ. Useful for local tunnels.
