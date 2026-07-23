## Why

`tiktok-publish` shipped video posting to TikTok (manually tested, working). TikTok's Content Posting API separately supports **photo posts** (a carousel of up to 35 images) via a different endpoint, still under the same `video.publish` scope Kelolako already has — no new App Review track needed to add this.

Kelolako already generates photos (`generate-photo`, Product Photo) stored as public Supabase Storage URLs, the same shape `video_url` already is for video posts. On the surface this looks like a small, additive extension of `tiktok-publish`.

**It isn't, for one specific reason found during exploration:** TikTok's photo endpoint supports **only `PULL_FROM_URL`** as a source — there is no `FILE_UPLOAD` equivalent for photos (confirmed against TikTok's own Content Posting API reference for the photo-post endpoint). `tiktok-publish`'s video flow deliberately chose `FILE_UPLOAD` specifically *to avoid* TikTok's URL-ownership verification requirement. Photo posts have no such escape hatch — `PULL_FROM_URL` requires TikTok to fetch the image directly from a URL whose **domain (or exact URL prefix) is verified as owned by this app** in the TikTok Developer Portal (a `tiktok-developers-site-verification` meta tag or DNS record). Kelolako's existing photo URLs are served directly from Supabase's own domain (`*.supabase.co`) — a domain Kelolako doesn't own and cannot verify. **This means the existing public photo URLs cannot be handed to TikTok as-is; a same-origin proxy under a domain Kelolako controls (`kelolako.com`) is a hard prerequisite, not an implementation detail.**

## What Changes

- **New same-origin photo-serving route** (`app/api/tiktok-photos/[...path]/route.ts` or similar) that streams (not redirects — TikTok's docs explicitly warn pulled URLs must not redirect) an image from Supabase Storage through a `kelolako.com` URL prefix, so that prefix can be verified in TikTok's Developer Portal and used as the `PULL_FROM_URL` target.
- **`lib/tiktok.ts`**: add `initPhotoPost` (POST to `/v2/post/publish/content/init/`, `media_type: "PHOTO"`, `post_mode: "DIRECT_POST"`, `source_info.source: "PULL_FROM_URL"`, `source_info.photo_images: [...]`) and `publishPhotoToTikTok` — no chunked upload step at all, since TikTok pulls the images itself; existing `getCreatorInfo`, `refreshAccessToken`, and the disclosure/privacy validation helper are reused unchanged. **Zero changes to the existing video `initDirectPost`/`uploadVideoChunks`/`publishToTikTok` path.**
- **`supabase/migrations`**: one additive column, `posts.photo_urls text[]` (nullable). No new "post type" column — a TikTok post is a photo post exactly when `photo_urls` is non-empty, mirroring how the schema already has no explicit "this is a video post" flag today (inferred from `video_url` being set). `tiktok_publish_id`, `tiktok_privacy_level`, `tiktok_brand_organic_toggle`, `tiktok_brand_content_toggle` are all reused as-is.
- **`app/api/cron/route.ts`**: TikTok branch gains a check — if `photo_urls` is populated, call `publishPhotoToTikTok` instead of `publishToTikTok`. YouTube's path and TikTok's existing video path are untouched.
- **Scheduler UI**: when TikTok is selected, a new multi-select photo picker (new interaction — every existing asset picker in this app is single-select) alongside the privacy-level dropdown and disclosure toggles already built for video (both reused as-is, since they're not video-specific).

## Capabilities

### New Capabilities
- `tiktok-photo-post`: scheduled posts targeting TikTok with one or more photos are automatically published as a TikTok photo post via the Content Posting API, through a Kelolako-controlled URL-verification proxy required for `PULL_FROM_URL`.

### Modified Capabilities
- `app/api/cron/route.ts`'s TikTok branch gains a photo-vs-video dispatch (was video-only).
- Scheduler UI's TikTok-selected state gains a photo picker path alongside the existing single-video picker.

## Impact

- **Backend:** new proxy route (new domain-verification-bearing surface), `lib/tiktok.ts` additions (additive only), `app/api/cron/route.ts` (small branch addition).
- **DB:** one additive column (`posts.photo_urls text[]`).
- **Frontend:** scheduler gains a multi-select photo picker, TikTok-only.
- **External/operational prerequisite (blocking, not code):** the chosen `kelolako.com` URL prefix must be verified in TikTok's Developer Portal *before* any end-to-end test can succeed — this cannot be done from code and should happen before implementation starts, not discovered as a failure partway through.
- **Out of scope (per explicit instruction):** any Instagram work; any change to existing TikTok **video** posting logic; polling TikTok's publish-status endpoint for final confirmation (this proposal keeps `tiktok-publish`'s optimistic-completion decision — see design.md); a UI for choosing which photo is the cover image (defaults to the first).
