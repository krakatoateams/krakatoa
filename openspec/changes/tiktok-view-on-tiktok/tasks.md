# Tasks

## 1. `lib/tiktok.ts`
- [x] 1.1 `fetchPublishStatus` reads raw response text (not just `res.json()`) and extracts `publicaly_available_post_id`'s first entry via `extractFirstPublicPostId` (design.md Decision 2)
- [x] 1.2 `TikTokPublishStatus`/`TikTokPublishOutcome`'s `"complete"` variant carry `publicPostId: string | null`
- [x] 1.3 `buildTikTokShareUrl(username, publicPostId)` — constructs `https://www.tiktok.com/@{username}/video/{id}`

## 2. `app/api/cron/route.ts`
- [x] 2.1 Import `getCreatorInfo`, `buildTikTokShareUrl`
- [x] 2.2 On `outcome.outcome === "complete"` with a non-null `publicPostId`, best-effort fetch the creator's username and build/store `tiktok_share_url` (try/catch, never blocks the already-confirmed publish)
- [x] 2.3 Update the route's top-of-file doc comment to mention the share-URL capture

## 3. DB migration
- [x] 3.1 `057_posts_tiktok_share_url.sql` — additive `posts.tiktok_share_url text`
- [ ] 3.2 (User action) Run the migration SQL manually in the Supabase SQL Editor (Supabase is currently egress-restricted — same manual-paste process used for prior migrations during this incident), or via `npm run db:setup` once normal access is restored

## 4. Calendar UI
- [x] 4.1 `Post` interface gains `tiktok_share_url?: string | null`
- [x] 4.2 "View on TikTok" button, rendered only when `post.status === "published" && post.tiktok_share_url`, mirroring the existing "View on YouTube" button's structure and using the same `Music2` icon already used elsewhere in this file as the TikTok icon

## 5. Verification
- [x] 5.1 `npx tsc --noEmit` passes
- [x] 5.2 Lint clean on new/edited files
- [ ] 5.3 (User action, manual, once Supabase + a real public TikTok publish are both available) Schedule and publish a real, non-SELF_ONLY TikTok post; confirm: `posts.tiktok_share_url` gets populated, the URL actually resolves to the real video on TikTok, and the Calendar's "View on TikTok" button appears and works
- [ ] 5.4 (User action) While doing 5.3, capture the raw JSON body of one real `PUBLISH_COMPLETE` status-fetch response (e.g. a temporary `console.log(rawText)`) and compare it against design.md Decision 2's assumed shape — confirm whether `publicaly_available_post_id` is actually sent quoted or bare, and whether `extractFirstPublicPostId`'s regex needs adjustment
- [ ] 5.5 (User action, operational, not code) Confirm whether `GET /api/connections/tiktok/creator-info` now returns any `privacy_level_options` beyond `SELF_ONLY` for the connected account, now that the app is approved for production (design.md Decision 4) — no code change expected either way, this is purely a verification step
