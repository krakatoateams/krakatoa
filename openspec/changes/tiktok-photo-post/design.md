## Context

`lib/tiktok.ts` currently has: `exchangeCodeForToken`, `refreshAccessToken` (rotates refresh token — must persist immediately per `connect-tiktok`'s hard constraint), `getCreatorInfo` (privacy options, comment/duet/stitch disabled flags, `resolveOrigin`), and the video publish path — `initDirectPost` (POST `/v2/post/publish/video/init/`, `source_info.source: "FILE_UPLOAD"`) + `uploadVideoChunks` (sequential `PUT`s with `Content-Range`) wrapped by `publishToTikTok`, which fetches the video into memory once, chunks it, and returns TikTok's `publish_id`. `app/api/cron/route.ts` dispatches to this by `post.platform === "tiktok"`; completion is optimistic (a returned `publish_id` = "published", no status polling — `tiktok-publish/design.md` Decision 1).

`posts` (migration `045_posts_tiktok_fields.sql`) has `tiktok_publish_id`, `tiktok_privacy_level`, `tiktok_brand_organic_toggle`, `tiktok_brand_content_toggle` — all nullable, meaningful only for `platform = 'tiktok'` rows. There is **no** existing "post type" column anywhere in the schema; a video post is simply one where `video_url` is set. Photo generation (`lib/product-photo-storage.ts`, `app/api/generate-photo/route.ts`) stores images the same way videos are stored — `getPublicUrl()` against the shared Supabase Storage bucket, giving a plain HTTPS URL under `*.supabase.co`.

**Researched against TikTok's own Content Posting API reference for the photo-post endpoint** (`POST /v2/post/publish/content/init/`, `media_type: "PHOTO"`):
- `source_info.source` supports **only `PULL_FROM_URL`** for photos. There is no `FILE_UPLOAD`-equivalent. (Sources: [Content Posting API — Photo Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post), [Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide).)
- `PULL_FROM_URL` requires the URL's domain or exact URL prefix to be verified as owned by the app in the TikTok Developer Portal, via a `tiktok-developers-site-verification` meta tag or DNS record. Verification is prefix-scoped: verifying `https://kelolako.com/tiktok-photos/` does **not** verify `https://kelolako.com/other-path/` or any other domain.
- The pulled URL **must not redirect** — TikTok's docs call this out explicitly. A same-origin proxy that issues an HTTP redirect to the real Supabase URL would violate this; the proxy must stream the bytes itself.
- `post_mode`: `DIRECT_POST` (publishes immediately, what we want) vs `MEDIA_UPLOAD` (sends to the user's TikTok inbox for manual completion — wrong UX for a scheduler that already promises auto-publish, matching why video uses `DIRECT_POST` too).
- `photo_images`: array of up to 35 URLs. `photo_cover_index` selects which one is the cover (not exposed in this proposal — defaults to `0`).
- `post_info` for photos: `title` (≤90 UTF-16 runes), `description` (≤4000 UTF-16 runes), `privacy_level` (required for `DIRECT_POST`), `disable_comment`, `brand_organic_toggle`, `brand_content_toggle`. **No duet/stitch fields exist for photos** — those concepts don't apply to a photo carousel, confirmed absent from the photo reference (matching the task's own expectation).

## Goals / Non-Goals

**Goals:**
- A due `posts` row with `platform: "tiktok"` and one or more photo URLs gets published as a TikTok photo post by the existing cron, through the same claim-lock/retry/idempotency contract already proven for video.
- Users can schedule a multi-photo TikTok post from the scheduler, reusing the privacy-level and disclosure UI already built for video (neither is video-specific).
- The `PULL_FROM_URL` domain-verification requirement is satisfied via a Kelolako-controlled proxy, not by asking TikTok to trust a third-party (Supabase) domain we don't own.

**Non-Goals:**
- No changes to the existing TikTok **video** path (`initDirectPost`, `uploadVideoChunks`, `publishToTikTok`) — explicitly out of scope per the task.
- No Instagram work.
- No status polling for final TikTok-side processing confirmation — same optimistic-completion posture as video (Decision 4 below), for the same reasons `tiktok-publish` gave.
- No cover-photo picker UI — always `photo_cover_index: 0` (the first photo in the array).
- No change to how `connect-tiktok` authorizes/stores tokens, and no new OAuth scope (photo posting is covered by the existing `video.publish` scope already granted).

## Decisions

### 1. A same-origin proxy route is a hard prerequisite, not an optimization
Because `PULL_FROM_URL` requires a domain Kelolako can verify, and the existing photo public URLs live on `*.supabase.co` (not ours to verify), a new route — e.g. `app/api/tiktok-photos/[...path]/route.ts` — fetches the image server-side from Supabase Storage and streams the response bytes directly (same `Content-Type`, no redirect). The URL TikTok is given is `https://kelolako.com/api/tiktok-photos/<storage-path>`, under a prefix verified once in the TikTok Developer Portal. This proxy is TikTok-specific plumbing, not a general-purpose image CDN change — it exists solely to give TikTok's puller a URL under a domain we control.

*Operational step, not code, and blocking*: the exact URL prefix (e.g. `https://kelolako.com/api/tiktok-photos/`) must be added and verified in the TikTok Developer Portal before any end-to-end photo-post test can succeed. This should happen in parallel with implementation, not be discovered as a failure afterward — flagged as task 1 in tasks.md.

### 2. `photo_urls text[]`, no new "post type" column
A TikTok post is a photo post exactly when `photo_urls` is non-null and non-empty; it's a video post when `video_url` is set. This mirrors the schema's existing implicit convention (there is no "is this a video post" flag today either) rather than introducing a `post_media_type` enum that could drift out of sync with which URL column is actually populated. `text[]` (not `jsonb`) because the data is simply an ordered list of URL strings — no nested structure to justify `jsonb`, and it maps 1:1 to `photo_images` with no encode/decode step, the same reasoning `tiktok-publish/design.md` used to choose two booleans over an enum for disclosure.

Existing columns reused as-is, unchanged meaning: `tiktok_publish_id` (idempotency — same purpose whether the underlying publish was a video or a photo carousel), `tiktok_privacy_level`, `tiktok_brand_organic_toggle`, `tiktok_brand_content_toggle`. `posts.title`/`posts.description` (already exist) map directly to the photo endpoint's `title`/`description` fields — no new text columns needed there.

### 3. `lib/tiktok.ts` grows two new functions; nothing existing changes
`initPhotoPost` (new, separate from `initDirectPost` — the request shape is different enough, `media_type`/`post_mode`/`source_info.photo_images` vs. `video_size`/`chunk_size`/`total_chunk_count`, that sharing one function would need a branchy shape rather than a clean one) and `publishPhotoToTikTok` (new, mirrors `publishToTikTok`'s shape but **has no upload step at all** — `PULL_FROM_URL` means TikTok fetches the images itself; a successful Init response's `publish_id` is the entire operation). Both reuse `getCreatorInfo` and `assertDisclosurePrivacyCompatible` unchanged. `initDirectPost`, `uploadVideoChunks`, and `publishToTikTok` are not touched — verified by keeping this change purely additive to the file.

### 4. Optimistic completion carries over unchanged
Same reasoning as `tiktok-publish` Decision 1: a returned `publish_id` from Init is treated as "published." Nothing about `PULL_FROM_URL` changes this calculus — if anything it's a *better* fit for the optimistic model than `FILE_UPLOAD`/video was, since TikTok fetching the image itself is a simpler, more atomic operation than a multi-chunk upload, but this proposal doesn't add polling either way, matching the explicit instruction to reuse this decision unless there's a reason not to (there isn't).

### 5. Cron dispatch: photo vs. video branch inside the existing TikTok path
`app/api/cron/route.ts`'s `if (post.platform === "tiktok")` branch gains one check — `if (post.photo_urls?.length) { … publishPhotoToTikTok … } else { … publishToTikTok … }` — before the refresh-then-persist-then-publish sequence, which is identical for both (the rotating-refresh-token hard constraint from `connect-tiktok` doesn't care what's being published). The YouTube branch is untouched; the existing video sub-path inside the TikTok branch is untouched except for gaining this one conditional above it.

### 6. Scheduler UI: new multi-select photo picker, existing privacy/disclosure UI reused
When TikTok is selected as the platform *and* the user chooses "Photo" as the content type (a new toggle, since today's scheduler only ever schedules one video), a picker analogous to the existing "My Assets" video picker appears, but multi-select (checkboxes, capped at 35, reusing `generate-photo`/Product Photo history as the source). The privacy-level dropdown and content-disclosure toggle + sub-checkboxes built for video in `tiktok-publish` are platform-level UI, not video-specific, and render identically for a photo post — no duplication needed. Duet/Stitch have no photo equivalent (per the API reference), so no such controls are shown when Photo is selected — only "Allow Comment" would apply if exposed (not currently exposed for video either — `disable_comment` isn't sent today — so this proposal doesn't add a comment toggle either, staying consistent with video's current minimal footprint rather than introducing an asymmetry).

## Risks / Trade-offs

- **Domain verification is an external, one-time manual step that blocks testing** — cannot be scripted or verified from code; must be done in the TikTok Developer Portal before task work past the proxy route can be end-to-end tested. Flagged prominently so it isn't discovered as a surprise failure.
- **The proxy route is new TikTok-specific attack surface**: it must only serve paths that are legitimately Kelolako-generated photos (not an open arbitrary-URL fetch proxy) — implementation must constrain it to the `photos/` storage prefix, never accept an arbitrary external URL.
- **`PULL_FROM_URL` failure modes are new and untested**: TikTok fetching our proxy could fail for reasons video's `FILE_UPLOAD` never encountered (proxy timeout, Supabase Storage transient error mid-stream, TikTok-side fetch timeout) — `initPhotoPost`'s error handling should surface TikTok's `url_ownership_unverified` and fetch-failure error codes distinctly where possible, so a misconfigured/not-yet-verified prefix produces an obviously diagnosable error rather than a generic failure.
- **Optimistic completion (Decision 4) inherits the same accepted risk as video** — a photo post could be marked "published" in Kelolako while TikTok later fails it in processing. Same acceptance rationale as `tiktok-publish`.
- **Sandbox/unaudited-app visibility restrictions inherited from video** — `SELF_ONLY`-only privacy for unaudited apps applies identically to photo posts; no new Sandbox-specific behavior to design around.

## Alternatives Considered

- **Verify Supabase's own domain in TikTok's Developer Portal instead of proxying** — not possible; domain verification requires control over the domain (DNS record or hosting a meta-tag file), and Kelolako doesn't control `*.supabase.co`.
- **Redirect instead of stream in the proxy route** — rejected: TikTok's docs explicitly state the pulled URL must not redirect; a 3xx response would make the proxy pointless.
- **`jsonb` instead of `text[]` for `photo_urls`** — rejected, same reasoning as `tiktok-publish`'s disclosure-field decision: a flat array of strings has no structure that benefits from `jsonb`, and `text[]` maps 1:1 to `photo_images` with no encode/decode step.
- **New `post_media_type` enum column** — rejected: would need to stay in sync with which URL column is populated, an invariant that can drift; inferring from `photo_urls` presence can't drift because there's nothing else to be inconsistent with.
- **Share one `initDirectPost`-style function for both video and photo** — rejected: the two request shapes (`source_info` fields, `media_type`, upload flow) diverge enough that a shared function would need internal branching that's less clear than two small, separate functions calling the same lower-level helpers (`getCreatorInfo`, `assertDisclosurePrivacyCompatible`).
