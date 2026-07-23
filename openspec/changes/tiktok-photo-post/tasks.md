# Tasks

## 1. Prerequisite (manual, blocking — do this first, in parallel with 2-4)
- [ ] 1.1 Choose the proxy URL prefix (e.g. `https://kelolako.com/api/tiktok-photos/`) and add + verify it as an owned URL Prefix in the TikTok Developer Portal (`tiktok-developers-site-verification` meta tag or DNS record, per [Content Posting API — Media Transfer Guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)). Nothing past task 2.1 can be end-to-end tested until this is live — flagged prominently so it isn't discovered as a failure partway through.

## 2. DB migration
- [ ] 2.1 New additive migration (next number after `045_posts_tiktok_fields.sql`) — `alter table posts add column if not exists photo_urls text[]`, with a header comment documenting: nullable, TikTok-only, a post is a "photo post" exactly when this is non-empty (no separate post-type column — mirrors how a "video post" is just one where `video_url` is set), and that `tiktok_publish_id`/`tiktok_privacy_level`/`tiktok_brand_organic_toggle`/`tiktok_brand_content_toggle` are reused unchanged for photo posts.

## 3. Photo-serving proxy route (satisfies the `PULL_FROM_URL` domain-verification requirement)
- [ ] 3.1 New route (e.g. `app/api/tiktok-photos/[...path]/route.ts`) that: validates the requested path resolves under the storage bucket's `photos/` prefix only (never an arbitrary URL — this must not become an open fetch proxy), fetches the object from Supabase Storage server-side, and streams the response body directly with the original `Content-Type` — **no redirect**, per TikTok's explicit requirement that pulled URLs must not redirect.
- [ ] 3.2 Confirm the deployed route's full URL falls under the exact prefix verified in task 1.1 (prefix matching is exact — verifying `.../tiktok-photos/` does not cover a differently-named path).

## 4. `lib/tiktok.ts` — photo publish helpers (additive only — zero changes to `initDirectPost`/`uploadVideoChunks`/`publishToTikTok`)
- [ ] 4.1 `initPhotoPost({ accessToken, photoUrls, title, description, privacyLevel, brandOrganicToggle, brandContentToggle })` — reuses `assertDisclosurePrivacyCompatible` unchanged; `POST /v2/post/publish/content/init/` with `post_mode: "DIRECT_POST"`, `media_type: "PHOTO"`, `source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photoUrls }`, `post_info: { title, description, privacy_level, brand_organic_toggle, brand_content_toggle }`; returns `{ publishId }` (no `upload_url` — nothing to upload).
- [ ] 4.2 `publishPhotoToTikTok({ accessToken, photoUrls, title, description, privacyLevel, brandOrganicToggle, brandContentToggle })` — orchestrates `getCreatorInfo` (reused, sanity-check the account can post) → `initPhotoPost`; returns `publishId`. Exported (this is what the cron calls). No fetch-into-memory/chunk step at all — `PULL_FROM_URL` means TikTok fetches the (proxied) URLs itself.
- [ ] 4.3 Map each `photoUrl` through the task-3 proxy (storage path → `https://kelolako.com/api/tiktok-photos/<path>`) before sending to `initPhotoPost` — this conversion belongs in `publishPhotoToTikTok`, not the cron, so callers never need to know about the proxy.

## 5. Cron dispatch
- [ ] 5.1 `app/api/cron/route.ts`'s existing `if (post.platform === "tiktok")` branch gains one check before the publish call: `if (post.photo_urls?.length) { … publishPhotoToTikTok(...) … } else { … publishToTikTok(...) … }` (existing video sub-path). The refresh-then-persist-then-publish ordering (rotating TikTok refresh token) is identical for both and untouched.
- [ ] 5.2 Success handling (mark published, store `tiktok_publish_id`, idempotency skip-if-already-set) reused as-is for both branches — no photo-specific status handling.
- [ ] 5.3 `isTikTokPermanentFailure` reused as-is; confirm photo-specific TikTok error codes (e.g. `url_ownership_unverified` if the proxy/verification isn't correctly set up) fall into a sensible bucket — likely permanent (won't self-heal on retry), worth a distinct message so a misconfigured prefix is obviously diagnosable rather than a generic failure.

## 6. Scheduler UI
- [ ] 6.1 New content-type toggle shown only when TikTok is selected: "Video" (existing flow, default) vs. "Photo" (new).
- [ ] 6.2 New multi-select photo picker (new interaction — every existing asset picker in this app is single-select) shown when "Photo" is chosen: checkboxes over Product Photo / `generate-photo` history, capped at 35 selections, ordered by selection order (first selected = `photo_cover_index: 0`).
- [ ] 6.3 Privacy-level dropdown and disclosure toggle + sub-checkboxes ("Your Brand" / "Branded Content", with the `SELF_ONLY` + Branded Content conflict disabling rule) reused unchanged from the video path — not video-specific, render identically for Photo.
- [ ] 6.4 No Duet/Stitch controls for Photo (none exist for video either currently, and none apply to photo posts per the API reference) — no new UI needed here, just confirm nothing from the video path leaks in incorrectly.
- [ ] 6.5 Single-mode and bulk-mode submit: send `photo_urls` (array) instead of `video_url` when Photo is selected; `POST /api/posts` accepts and stores `photo_urls`, still requires `tiktok_privacy_level` for TikTok posts, still rejects the `SELF_ONLY` + Branded Content combination — same validation, now applied regardless of whether `video_url` or `photo_urls` was provided.

## 7. Verification
- [ ] 7.1 `npx tsc --noEmit` clean.
- [ ] 7.2 Lint clean on all new/edited files.
- [ ] 7.3 Manual: hit the task-3 proxy route directly for a known photo and confirm it returns the image bytes with correct `Content-Type` and no redirect (`curl -sD -` showing a `200`, not a `3xx`).
- [ ] 7.4 Manual (Sandbox, Target User account, after task 1.1 verification is live): schedule a TikTok photo post (2-3 images) via the scheduler UI, let cron pick it up, confirm a `publish_id` is returned and the post is marked published with `tiktok_publish_id` set.
- [ ] 7.5 Manual: confirm a post scheduled without a live TikTok connection still cannot select TikTok as a platform (unchanged from video — re-verify, don't just assume).
- [ ] 7.6 Manual: confirm scheduling and publishing a TikTok **video** post still works unchanged after this change lands (regression check on the explicitly-out-of-scope path).
- [ ] 7.7 Manual: attempt the proxy/photo flow *before* task 1.1's verification is confirmed live, to see and document what error TikTok actually returns (`url_ownership_unverified` or otherwise) — useful reference for support/debugging if verification ever lapses or a new prefix is added later.
