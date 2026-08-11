## Why

Two related gaps, both rooted in the same fact: this app was Sandbox-only until now, so every TikTok post ever published was forced to `privacy_level = SELF_ONLY`.

1. **No "View on TikTok" button.** Unlike YouTube (`https://www.youtube.com/watch?v={youtube_video_id}`, trivially derivable from a stored video ID), TikTok has no equivalent derivable-from-an-ID URL scheme — you need a real permalink, and TikTok's status-fetch endpoint only returns the post ID needed to build one ("`publicaly_available_post_id`") **once a post is confirmed `PUBLISH_COMPLETE` AND its `privacy_level` is public** (TikTok's own docs: "returned only if the post is published for public viewership"). A `SELF_ONLY` post — which is what every Sandbox-era post was — never had this field populated, so there was nothing to build a button from. Now that the app can publish publicly, this field becomes available for the first time.
2. **Publish-status verification for TikTok — turns out this is *already implemented*, contrary to this task's framing.** Investigation (see `design.md` Context) confirms `app/api/cron/route.ts` already calls `waitForTikTokPublishOutcome` after every TikTok Init call — for both video **and** photo posts, not gated by `isPhotoPost` — polling TikTok's real status/fetch endpoint until `PUBLISH_COMPLETE`/`FAILED`/a bounded "pending" timeout, before ever marking a post `published`. This shipped as part of `tiktok-photo-post`'s bug-history fix, and was never scoped to photos only. **No new verification work was needed or done here** — this proposal only adds the share-URL capture on top of the verification that already exists.

## What Changes

- `lib/tiktok.ts`: `fetchPublishStatus`/`waitForTikTokPublishOutcome` now also extract TikTok's `publicaly_available_post_id` (precision-safely — see `design.md` Decision 2) when present, and a new `buildTikTokShareUrl(username, publicPostId)` helper constructs `https://www.tiktok.com/@{username}/video/{id}`.
- `app/api/cron/route.ts`: on a confirmed `complete` outcome, if a public post ID came back, best-effort fetches the creator's username (`getCreatorInfo`, already used elsewhere in this same file) and stores the resulting share URL — never blocks the already-confirmed publish if this secondary step fails.
- New additive migration: `posts.tiktok_share_url` (mirrors `youtube_video_id`/`tiktok_publish_id`'s role for their own "view" buttons).
- Calendar UI (`app/(app)/tools/scheduler/calendar/page.tsx`): new "View on TikTok" button, rendered only when `tiktok_share_url` is present — mirrors the existing "View on YouTube" button exactly, using the same `Music2` icon already used elsewhere in this file as the TikTok platform icon.
- **No change** to `privacy_level` handling — see `design.md` Decision 4: it was already fetched live from TikTok's Creator Info endpoint and surfaced as a required, never-silently-defaulted dropdown (`tiktok-publish` Decision 4, already shipped). Flagged for the user's operational confirmation, not a code gap.

## Capabilities

### New Capabilities
- `tiktok-view-on-tiktok`: a genuinely-published (public, non-SELF_ONLY) TikTok post gets a real, storable share URL and a "View on TikTok" button in the Calendar, matching YouTube's existing pattern.

### Modified Capabilities
- None. This builds directly on `tiktok-publish` (privacy-level capture, already dynamic) and `tiktok-photo-post` (the status-verification polling this proposal was asked to design, but which already exists).

## Impact

- **Backend:** `lib/tiktok.ts`, `app/api/cron/route.ts`.
- **Frontend:** `app/(app)/tools/scheduler/calendar/page.tsx`.
- **DB:** `057_posts_tiktok_share_url.sql`, additive.
- **Out of scope:** any change to `privacy_level` defaulting/UI (already correct, see Decision 4); a share URL or equivalent for SELF_ONLY posts (none exists — TikTok doesn't expose one).
- **Cannot be tested end-to-end right now:** Supabase is currently egress-restricted (separate, active incident), and a real test additionally requires an actual public TikTok publish to observe the true response shape/timing for `publicaly_available_post_id`. Code is written defensively (see `design.md` Decision 2) but the exact TikTok response has not been observed live during this change — flagged as the main verification gap in `tasks.md`.
