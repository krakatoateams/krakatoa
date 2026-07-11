## Why

`connect-tiktok` only obtains and stores TikTok tokens — nothing in the codebase actually publishes to TikTok yet. Krakatoa's scheduler (`app/api/cron/route.ts`) is hardcoded to YouTube: it fetches a `platform_tokens` row keyed by `post.platform` but always calls `uploadToYouTube` regardless of what that platform is, and the scheduler UI (`app/(app)/tools/scheduler/page.tsx`) hardcodes `platform: "youtube"` on every created post (single and bulk), with a static, non-functional "Platform" selector showing only YouTube and a "More platforms coming soon" caption.

Two forcing functions:
1. **Product goal**: the whole point of connecting TikTok is auto-publishing scheduled videos there, matching what YouTube already does.
2. **TikTok App Review**: the `video.publish` scope requires demonstrating actual publish usage, not just the OAuth consent screen — a screen recording of Connect alone would not support a review submission.

## What Changes

- **`lib/tiktok.ts`**: add a chunked-upload Init Direct Post flow (`FILE_UPLOAD` source) built on top of the existing `getCreatorInfo` and `refreshAccessToken` helpers, producing a `publish_id`.
- **`app/api/cron/route.ts`**: dispatch by `post.platform` — YouTube keeps its existing path unchanged; a new TikTok path refreshes the access token (persisting the rotated `refresh_token` immediately), fetches Creator Info, runs Init Direct Post, and marks the post published on a successful `publish_id` (optimistic — no polling for final TikTok-side processing status).
- **`supabase/migrations/045_posts_tiktok_fields.sql`**: additive columns `posts.tiktok_publish_id` (idempotency, mirrors `youtube_video_id`) and `posts.tiktok_privacy_level` (captured at schedule time, not defaulted silently — see design.md).
- **Scheduler UI** (`app/(app)/tools/scheduler/page.tsx`): turn the static "Platform" block into a real selector (YouTube / TikTok, TikTok only shown if the user has a live TikTok connection), for both single-post and bulk scheduling paths; add a privacy-level dropdown when TikTok is selected, sourced from TikTok's own `creator_info` privacy options.

## Capabilities

### New Capabilities
- `tiktok-publish`: scheduled posts targeting TikTok are automatically published via the Content Posting API when due, following the same claim-lock/retry contract the cron already uses for YouTube.

### Modified Capabilities
- Scheduler UI's post-creation flow gains a real platform choice (was YouTube-only).
- `app/api/cron/route.ts` gains per-platform dispatch (was YouTube-only in practice despite generic-looking token lookup).

## Impact

- **Backend:** `lib/tiktok.ts` (new publish functions), `app/api/cron/route.ts` (platform dispatch + TikTok branch).
- **Frontend:** `app/(app)/tools/scheduler/page.tsx` (platform selector + privacy-level field, single + bulk).
- **DB:** `supabase/migrations/045_posts_tiktok_fields.sql` (additive, idempotent).
- **Out of scope (deferred):**
  - Polling TikTok's publish-status endpoint for final confirmation (optimistic completion only, per explicit product decision — see design.md).
  - Full TikTok content-disclosure UI (branded-content toggles) beyond the required privacy-level choice — flagged as a review risk, not solved here.
  - Instagram or any platform beyond YouTube/TikTok.
  - Any change to `connect-tiktok`'s scope (OAuth/token storage) beyond what publish needs to read.
