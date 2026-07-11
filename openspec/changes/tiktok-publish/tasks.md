# Tasks

## 1. DB migration
- [x] 1.1 `supabase/migrations/045_posts_tiktok_fields.sql` — `alter table posts add column if not exists tiktok_publish_id text`, `add column if not exists tiktok_privacy_level text`, `add column if not exists tiktok_brand_organic_toggle boolean`, `add column if not exists tiktok_brand_content_toggle boolean` (additive, idempotent, header comment documenting purpose and the SELF_ONLY + brand_content_toggle conflict rule). Applied manually via Supabase SQL Editor; confirmed live via PostgREST (`posts` query returns all 4 columns with correct `text`/`boolean` types and matching `comment on column` descriptions).

## 2. `lib/tiktok.ts` — publish helpers
- [x] 2.1 `initDirectPost({ accessToken, videoUrl, title, privacyLevel, brandOrganicToggle, brandContentToggle })` — validates `!(brandContentToggle && privacyLevel === "SELF_ONLY")` up front (throws, doesn't silently drop the flag); `POST /v2/post/publish/video/init/` with `source_info: { source: "FILE_UPLOAD", video_size, chunk_size, total_chunk_count }` and `post_info: { title, privacy_level, brand_organic_toggle, brand_content_toggle }`; returns `{ publishId, uploadUrl }`. **Deviation:** fetches the full video into memory to get an exact byte size instead of a `HEAD` request (more reliable — some storage/CDN configs don't return accurate `Content-Length` on HEAD) — no extra round trip since the same bytes are then sliced into chunks. Not exported (only used internally by `publishToTikTok`) since nothing else needs it.
- [x] 2.2 `uploadVideoChunks(uploadUrl, video, chunkSize, totalChunkCount)` — **Deviation:** takes the already-fetched video bytes (`Uint8Array<ArrayBuffer>`) instead of re-fetching by URL, avoiding a second network round-trip; `PUT`s sequential chunks with correct `Content-Range` headers. Not exported, same reasoning as 2.1.
- [x] 2.3 `publishToTikTok({ accessToken, videoUrl, title, privacyLevel, brandOrganicToggle, brandContentToggle })` — orchestrates `getCreatorInfo` → fetch video once → `initDirectPost` → `uploadVideoChunks`; returns the `publishId`. Exported (this is what the cron calls).

## 3. Cron dispatch
- [x] 3.1 `app/api/cron/route.ts` — branches on `post.platform`; YouTube path is byte-for-byte unchanged, now reached via an added `else` after the TikTok branch
- [x] 3.2 TikTok branch: looks up the `platform_tokens` row (already generic), calls `refreshAccessToken`, **immediately** upserts the rotated `refresh_token` + new `access_token`/`expires_at` into `platform_tokens` before doing anything else
- [x] 3.3 Calls `publishToTikTok` with the fresh access token, `post.video_url`, `post.title`, `post.tiktok_privacy_level`, `post.tiktok_brand_organic_toggle`, and `post.tiktok_brand_content_toggle`; on success, marks the post published and stores `tiktok_publish_id` (mirrors the existing `youtube_video_id` idempotency check — skips re-publishing if already set)
- [x] 3.4 Added `isTikTokPermanentFailure` (auth/reconnect errors + the SELF_ONLY/branded-content conflict → permanent/no-retry; everything else → transient/retry), reusing the existing `MAX_PUBLISH_ATTEMPTS` retry/give-up logic

## 4. Scheduler UI
- [x] 4.1 New `GET /api/connections/tiktok/creator-info` wrapping `getCreatorInfo` (with refresh-then-persist-then-retry on token expiry) to surface `privacy_level_options` to the client
- [x] 4.2 Static "Platform" block replaced with a real `<select>` (shared `PlatformFields` component): fetches `/api/connections/status`, shows YouTube always, shows TikTok only when `tiktok: true`
- [x] 4.3 TikTok selection shows a required privacy-level dropdown sourced from 4.1; choice stored in lifted `VideoItem` state (single via `handleItem0PlatformPatch`, bulk via existing `onUpdate`)
- [x] 4.4 "Disclose video content" toggle + "Your Brand" / "Branded Content" checkboxes added; "Branded Content" is disabled whenever privacy is `SELF_ONLY`, with an inline explanatory note
- [x] 4.5 Single-mode submit sends the selected `platform` + (if TikTok) the three `tiktok_*` fields instead of the hardcoded `"youtube"`
- [x] 4.6 Bulk-mode submit: same platform/privacy-level/disclosure wiring
- [x] 4.7 `POST /api/posts`: accepts and stores `tiktok_privacy_level` + the two disclosure booleans; rejects (400) `tiktok_brand_content_toggle: true` with `tiktok_privacy_level: "SELF_ONLY"` together, mirroring `lib/tiktok.ts`'s publish-time check

## 5. Verification
- [x] 5.1 `npx tsc --noEmit` passes — zero errors (fixed a real bug found here: `uploadVideoChunks` passed a Node `Buffer` slice straight to `fetch()`'s `body`, which TS's `BodyInit` type rejects since `Buffer`'s `.buffer` is typed as the wider `ArrayBufferLike`, not `ArrayBuffer`. Fixed by sourcing the video as a plain `Uint8Array<ArrayBuffer>` directly from `arrayBuffer()` instead of wrapping in `Buffer.from(...)` — `.subarray()` on it stays assignable to `BodyInit` with zero copies, same bytes)
- [x] 5.2 Lint clean on all new/edited files (3 pre-existing warnings elsewhere in the scheduler page, unrelated to this change, left as-is)
- [ ] 5.3 Manual (Sandbox, Target User account): schedule a TikTok post via the scheduler UI, let cron pick it up, confirm a `publish_id` is returned and the post is marked published with `tiktok_publish_id` set
- [ ] 5.4 Manual: verify the refresh-then-persist ordering — force a token refresh (e.g. by checking logs during a real cron run) and confirm the new `refresh_token` is in `platform_tokens` even if you kill/fail the run before publish completes
- [ ] 5.5 Manual: confirm a post scheduled without a live TikTok connection cannot select TikTok as a platform in the UI
- [ ] 5.6 Manual: confirm the "Branded Content" checkbox is disabled whenever `SELF_ONLY` is selected (expected to be the only option available pre-App-Review), and that "Your Brand" alone can still be scheduled and published
- [ ] 5.7 Record the full flow (Connect → schedule a TikTok post, including the disclosure toggle with "Your Brand" enabled → cron publishes it → video appears, even if Sandbox-restricted to the Target User) for the App Review submission. Note in the recording/submission notes that "Branded Content" could not be demoed pre-review due to the SELF_ONLY constraint (Decision 4a)
