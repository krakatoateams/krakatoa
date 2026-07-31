## Why

The Connections tab (`app/(app)/dashboard/settings/ConnectionsTab.tsx`) already reserves an Instagram row, but it's a static `StaticConnectionRow status="soon"` stub (Camera icon, "Auto-publish Reels to Instagram") with no backing OAuth flow or publish logic — same starting point TikTok was in before `connect-tiktok`.

The Meta app is already registered with a redirect URI configured in the Meta Developer Portal (`https://www.kelolako.com/api/connections/instagram/callback`) and the scopes this integration needs (`instagram_business_basic`, `instagram_business_content_publish`). Nothing in the codebase consumes them yet.

TikTok and YouTube already proved the pattern to mirror: independent per-platform OAuth ("Model B" — `app/api/connections/{platform}/{start,callback}` + a `DELETE` disconnect route), a generic `platform_tokens` table keyed by `(user_id, platform)`, and cron dispatch keyed by `post.platform` in `app/api/cron/route.ts`. Instagram should follow that same shape rather than inventing a new one.

**Direct lesson from TikTok's own history, applied up front here:** `tiktok-photo-post` had to retrofit a status-polling fix after photo posts silently sat as "published" in our DB while TikTok's real, asynchronous processing had actually failed (`file_format_check_failed`) — Init succeeding only meant TikTok *accepted* the request, not that it finished. Instagram's Content Publishing API has its own two-step async model (create a container, poll `status_code`, only then publish) — and unlike TikTok, Instagram's `media_publish` call **requires** the container to already be `FINISHED` as a precondition, so the status check isn't optional even at a basic-correctness level. This proposal designs that verification into the very first implementation (see `design.md` Decisions 3–4), not as a follow-up bug fix.

## What Changes

- New OAuth authorize/callback/disconnect routes under `app/api/connections/instagram/` (`start`, `callback`, `route.ts` DELETE), mirroring the YouTube/TikTok trio's CSRF-cookie handling and settings-redirect error convention.
- New `lib/instagram.ts`: the 3-hop token lifecycle (auth code → short-lived token → long-lived 60-day token, plus long-lived token refresh), container creation (photo `IMAGE` / video `REELS`), single-check status polling, and `media_publish`.
- `ConnectionsTab.tsx` promotes Instagram from a static "Coming soon" stub to an interactive connect/disconnect row, copying the YouTube/TikTok rows' state and UI pattern.
- `/api/connections/status` adds an `instagram` boolean alongside `youtube` and `tiktok`.
- New `if (post.platform === "instagram")` branch in `app/api/cron/route.ts`: creates (or resumes) a container, does **one** status check per cron tick (not an in-request busy-loop — see Decision 4, this is the key structural difference from the TikTok branch), and calls `media_publish` once the container reports `FINISHED`.
- New additive migration: `posts.instagram_container_id` (pre-publish idempotency/resume) and `posts.instagram_media_id` (post-publish idempotency), mirroring `tiktok_publish_id` / `youtube_video_id`.
- Scheduler UI: the `platforms` union type widens to include `"instagram"`, `PLATFORM_LABELS` gains an entry, and the Instagram checkbox is only offered once `/api/connections/status` reports `instagram: true` — mirroring `tiktok-publish` Decision 7. Unlike YouTube (video-only, already disabled for photo cards), Instagram accepts both photo and video/reel content per this task's scope, so its checkbox stays enabled for both card content types.
- A new periodic job to proactively refresh the long-lived Instagram token before its 60-day expiry (see `design.md` Decision 2b) — exact shape (new cron route vs. piggybacking an existing one) flagged as an open question.
- New env vars for the Meta app credentials (exact naming flagged as an open question), provisioned in `.env.local` and Vercel (not committed).

## Capabilities

### New Capabilities
- `connect-instagram`: users can authorize and revoke an Instagram Business account connection via Instagram Business Login; tokens are persisted and proactively refreshed.
- `publish-instagram`: scheduled photo and video/reel posts publish to a connected Instagram Business account, with container-status verification before a post is ever marked "published."

### Modified Capabilities
- None formally modified. This extends the connections surface (`profile-settings`) and the cron dispatch-by-platform pattern (`scheduler-cron-publish`, `tiktok-publish`) that YouTube and TikTok already established.

## Impact

- **Backend:** 3 new route files (`start`, `callback`, `route.ts` DELETE) + 1 new lib helper (`lib/instagram.ts`) + 1 modified route (`status`) + 1 modified route (`cron`) + 1 new periodic-refresh route (shape TBD, see Open Questions).
- **Frontend:** `ConnectionsTab.tsx` + `app/(app)/tools/scheduler/page.tsx` (platform type, label, checkbox gating).
- **DB:** `056_platform_tokens_nullable_refresh_token.sql` (Phase 1), `057_posts_tiktok_share_url.sql` (unrelated TikTok work, same migration sequence), `058_platform_tokens_platform_user_id.sql` (Phase 2 — fixes a Phase 1 gap, see below), `059_posts_instagram_fields.sql` (Phase 2 — `instagram_container_id`, `instagram_media_id`, `instagram_first_attempted_at`).
- **Env:** 2 new secrets to provision outside code (`.env.local` + Vercel).
- **Out of scope (deferred):**
  - Carousel posts (multiple images in one Instagram post) — this change treats Instagram photo posts as single-image only, matching the task's "photo + video/reel" framing (not "photo carousel").
  - Instagram Stories.
  - Messaging / comment management — `instagram_business_manage_messages` and `instagram_business_manage_comments` are deliberately **not** requested scopes; this integration is publish-only, same scope boundary as TikTok/YouTube.
  - Content-publishing-limit dashboarding beyond basic error classification (see `design.md` Decision 8).
  - Phase 3 (proactive token refresh cron) and Phase 4 (scheduler UI) — not started.
- **Open questions requiring confirmation:** see `design.md` § Open Questions — the token-refresh job's cadence/shape (Phase 3) and scheduler-UX calls around single-image-only photo posts (Phase 4). Env var naming, the 10-minute give-up threshold, and the Business/Creator detection mechanism were confirmed and implemented in Phase 2.

## Phase 2 status (2026-07-31)

**Implemented:** `lib/instagram.ts`'s publish functions (`createMediaContainer`, `getContainerStatus`, `publishContainer`, `ensureInstagramCompatibleImage`, `isInstagramPermanentFailure`), the full cron branch in `app/api/cron/route.ts`, and 2 new migrations. See `design.md` § Phase 2 for re-verified API details and several things Phase 1 didn't anticipate — most importantly, **`platform_tokens.platform_user_id` was never persisted in Phase 1**, meaning the publish endpoints could not have been called at all until this phase's fix (`058_...sql` + a one-line fix to the Phase 1 callback route).

**Also fixed (2026-07-31):** `POST /api/posts` previously hard-rejected any `photo_urls` post targeting a platform other than `"tiktok"` — an Instagram photo post couldn't be created via the API at all, even for manual testing. Now accepts `photo_urls` for `platform === "instagram"` too, with its own validation rejecting more than 1 photo (Instagram has no carousel support — matches the cron's `photo_urls[0]`-only handling, but rejects up front rather than silently dropping extras), and `insertRow.photo_urls` is now actually persisted for Instagram posts (it was previously only assigned inside the TikTok-only branch, so it would have been silently dropped even once the platform check allowed it through).

**Not implemented, flagged for your review before relying on this:**
- Instagram requires JPEG-only images (stricter than TikTok, which also accepts WebP) — handled via a new `ensureInstagramCompatibleImage`, but **unverified against a real Instagram publish**.
- This app's Rendi FFmpeg video pipeline doesn't set `-movflags +faststart`, which Instagram's Reels container spec explicitly requires ("moov atom at the front of the file") — not fixed here (it's the generation pipeline, not this integration), but flagged as a plausible cause of real publish failures specific to Instagram video/reel posts.
- The signed-URL-reuse assumption (`design.md` Decision 7) remains unverified — no new evidence either way was found this phase.

Nothing above was tested live — Supabase access is still restricted. See `tasks.md` for the exact verification steps once it's back.
