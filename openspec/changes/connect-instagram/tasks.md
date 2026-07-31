# Tasks

Phased per the confirmed decisions in `design.md`. **Phase 1 and Phase 2 are both implemented** (Phase 2 as of 2026-07-31); Phases 3–4 remain future work.

## Phase 1 — OAuth connect/disconnect only

### 0. DB migration (discovered necessary during Phase 1, not assumed up front)
- [x] 0.1 `056_platform_tokens_nullable_refresh_token.sql` — drops `platform_tokens.refresh_token`'s `NOT NULL` constraint (Instagram writes a genuine `null`; YouTube's `?? null` had never actually exercised that path)
- [ ] 0.2 (User action) Run the migration's SQL in the Supabase SQL Editor (same manual process used for `054_posts_failed_at.sql`) — `npm run db:setup` applies it automatically for any environment where that's run instead

### 1. Shared origin resolution (design.md Decision 13)
- [x] 1.1 Extract `resolveOrigin` from `lib/tiktok.ts` into new `lib/http.ts`
- [x] 1.2 `lib/tiktok.ts` re-exports `resolveOrigin` from `lib/http.ts` (zero changes needed at existing call sites in `app/api/connections/tiktok/{start,callback}` and `app/api/cron/route.ts`)

### 2. Env & credentials
- [x] 2.1 `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` referenced in code (values to be provisioned by the user in `.env.local` + Vercel — not committed)
- [ ] 2.2 (User action) Add the two vars to `.env.local` and the Vercel project environment
- [ ] 2.3 (User action) Confirm the redirect URI `https://www.kelolako.com/api/connections/instagram/callback` is registered exactly in the Meta Developer Portal, and that the app has `instagram_business_basic` + `instagram_business_content_publish` configured
- [ ] 2.4 (User action) Confirm at least one test Instagram account is converted to a Business or Creator account

### 3. `lib/instagram.ts` — connect-time functions only
- [x] 3.1 `exchangeCodeForToken(code, redirectUri)` — `POST https://api.instagram.com/oauth/access_token`, form-encoded (`client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`); parse `{ data: [{ access_token, user_id, permissions }] }`; return `{ accessToken, userId, permissions }`
- [x] 3.2 `exchangeForLongLivedToken(shortLivedToken)` — `GET https://graph.instagram.com/access_token` (`grant_type=ig_exchange_token`, `client_secret`, `access_token`); return `{ accessToken, expiresIn }`
- [x] 3.3 Business/Creator eligibility check (design.md Decision 12) — inspect the `permissions` string from 3.1's response for `instagram_business_content_publish`; exposed as a small helper so `callback` can reject before ever calling 3.2
- [ ] 3.4 `refreshLongLivedToken` — **Phase 3**, not implemented yet
- [x] 3.5 Container/publish functions (`createMediaContainer`, `getContainerStatus`, `publishContainer`) — **Phase 2, implemented**
- [x] 3.6 `isInstagramPermanentFailure` — **Phase 2, implemented**
- [x] 3.7 (Phase 2, not originally planned) `ensureInstagramCompatibleImage` — JPEG-only conversion, discovered as a real requirement (stricter than TikTok, which also accepts WebP) during Phase 2's re-verification, not assumed from Phase 1

### 4. Connect routes
- [x] 4.1 `app/api/connections/instagram/start/route.ts` — build `https://www.instagram.com/oauth/authorize` (`client_id`, `redirect_uri`, `response_type=code`, `scope=instagram_business_basic,instagram_business_content_publish`, `state`) using `resolveOrigin` from `lib/http.ts`, set an `instagram_oauth_state` cookie (httpOnly, `maxAge: 300`, `sameSite: lax`, `path: "/"`), redirect
- [x] 4.2 `app/api/connections/instagram/callback/route.ts` — verify `state` against the cookie before reading `code`; on success call `exchangeCodeForToken`, reject (no `platform_tokens` write) with `error=instagram_not_business_account` if `instagram_business_content_publish` is missing from the granted `permissions`, otherwise call `exchangeForLongLivedToken` and upsert `platform_tokens` (`platform: "instagram"`, `refresh_token: null`, `onConflict: "user_id,platform"`); on any other failure redirect with `error=instagram_connect_failed` or `error=invalid_state`; clear the state cookie on every exit path
- [x] 4.3 `app/api/connections/instagram/route.ts` — `DELETE` handler removing the `platform_tokens` row for `(user_id, "instagram")`, mirroring the YouTube/TikTok disconnect routes
- [x] 4.4 (Phase 2 fix to this Phase 1 file) Persist `shortLived.userId` into the new `platform_tokens.platform_user_id` column on upsert — previously computed but discarded after the eligibility check; without this, the publish endpoints (Phase 2) could never have been called at all (see design.md Phase 2 § Re-verification)

### 5. Status & UI
- [x] 5.1 `app/api/connections/status/route.ts` — add `instagram: connected.has("instagram")` to the response
- [x] 5.2 `ConnectionsTab.tsx` — promote the Instagram stub row (`Camera` icon) from `StaticConnectionRow status="soon"` to the interactive connect/disconnect block; add `instagramConnected` state, fetch from `/api/connections/status`, wire Connect to `/api/connections/instagram/start`, wire disconnect to `DELETE /api/connections/instagram`, handle `instagram_connect_failed` / `instagram_not_business_account` / `invalid_state` redirect-back errors

### 6. Verification
- [x] 6.1 `npx tsc --noEmit` passes
- [x] 6.2 Lint clean on new/edited files
- [ ] 6.3 (User action, manual) Connect a Business/Creator Instagram account end-to-end; confirm a `platform_tokens` row is created with `platform="instagram"`, a non-null `access_token`, `refresh_token` null, and a ~60-day `expires_at`
- [ ] 6.4 (User action, manual) Attempt connecting a Personal (non-Business/Creator) account if feasible; confirm the flow is rejected with `instagram_not_business_account` and no `platform_tokens` row is written — this is also the empirical check design.md Decision 12 flags as unconfirmed (whether Meta's own authorize step already blocks Personal accounts, vs. relying solely on our permissions check)
- [ ] 6.5 (User action, manual) Disconnect; confirm the row is deleted and `ConnectionsTab` reverts to the "Connect" state
- [x] 6.6 `npx tsc --noEmit` passes (Phase 2 changes)
- [x] 6.7 Lint clean on new/edited Phase 2 files
- [ ] 6.8 (User action, manual, once Supabase access is restored AND task 7.6 is resolved) Schedule a real Instagram video/reel post; confirm: a container is created, `instagram_container_id` is persisted immediately, status polling progresses across cron ticks (don't assume a single-tick FINISHED), `media_publish` succeeds, `instagram_media_id` is stored, and the post is actually visible on the real Instagram account
- [ ] 6.9 (User action, manual, once task 7.6 is resolved) Schedule a real Instagram photo post; confirm the JPEG-conversion path actually works against a real (likely PNG) generated asset, and that Meta's fetcher successfully retrieves the signed Supabase URL — this is the single most important thing to confirm, since Decision 7's signed-URL reuse has no live confirmation either way
- [ ] 6.10 (User action) While doing 6.8/6.9, log the raw response bodies from `createMediaContainer`/`getContainerStatus`/`publishContainer` at least once and compare against design.md's assumed shapes — same "verify before trusting" step this app's own history (OAuth endpoints, TikTok's `publicaly_available_post_id`) has twice shown is worth doing before relying on documented shapes alone

## Phase 2 — Publish flow (implemented 2026-07-31)
- [x] 7.1 New additive migrations: `058_platform_tokens_platform_user_id.sql`, `059_posts_instagram_fields.sql` (`instagram_container_id`, `instagram_media_id`, `instagram_first_attempted_at` — one more column than Phase 1 anticipated, needed for task 7.4)
- [ ] 7.1a (User action) Run both migrations' SQL manually in the Supabase SQL Editor — Supabase is still egress-restricted
- [x] 7.2 `lib/instagram.ts`: `createMediaContainer`, `getContainerStatus`, `publishContainer`, `isInstagramPermanentFailure`, plus `ensureInstagramCompatibleImage` (not originally planned — see task 3.7)
- [x] 7.3 New `if (post.platform === "instagram")` branch in `app/api/cron/route.ts`: idempotency short-circuit on `instagram_media_id`; else create-or-resume container, exactly one status check per tick (design.md Decision 4), branch on `FINISHED`/`IN_PROGRESS`/`ERROR`/`EXPIRED`
- [x] 7.3a Widened `isPhotoPost` to include `platform === "instagram"`; fixed the `!token.refresh_token` throw to skip Instagram (its `platform_tokens` row always has `refresh_token = null` by design — this check would otherwise have thrown on every single Instagram publish attempt)
- [x] 7.4 10-minute wall-clock give-up threshold (design.md Decision 6) — `INSTAGRAM_GIVE_UP_MS`, measured from `instagram_first_attempted_at`, clears `instagram_container_id`/`instagram_first_attempted_at` on give-up (and on `ERROR`/`EXPIRED`) so a retry starts clean
- [x] 7.5 Reuse `signStoragePathForPublish`/`resolvePublishVideoUrl` for both photo and video containers (design.md Decision 7) — implemented as designed, **still unverified empirically** (see design.md Risks)
- [x] 7.6 `POST /api/posts` — fixed: `photo_urls` now accepted for `platform === "instagram"` (in addition to `"tiktok"`), with a dedicated rejection if more than 1 photo is submitted for Instagram (no carousel support — matches the cron's own `photo_urls[0]`-only handling, but rejects up front instead of silently dropping extras); the "can't mix photos and video" guard now applies to Instagram too; `insertRow.photo_urls` is now persisted for Instagram posts (previously only assigned inside the `platform === "tiktok"` block, so it would have been silently dropped even if the platform check had allowed it through)
- [ ] 7.7 (Flagged, not fixed here) Confirm whether `lib/reels-pipeline`'s Rendi FFmpeg output needs `-movflags +faststart` added for Instagram's Reels container spec ("moov atom at the front of the file") — currently absent; TikTok/YouTube have not needed this, Instagram's docs list it explicitly

## Phase 3 — Proactive token refresh (future change, not this one)
- [ ] 8.1 `lib/instagram.ts`: `refreshLongLivedToken` (design.md Decision 2, endpoint already researched)
- [ ] 8.2 New daily cron route selecting `platform_tokens` rows (`platform = "instagram"`) with `expires_at` inside the next 7–14 days, calling `refreshLongLivedToken` and persisting the result (design.md Decision 2b)
- [ ] 8.3 Register the cron in `vercel.json`, matching the existing native-cron convention

## Phase 4 — Scheduler UI (future change, not this one; depends on Phase 2)
- [ ] 9.1 Widen `platforms: Array<"youtube" | "tiktok">` to include `"instagram"` everywhere the union is spelled out in `app/(app)/tools/scheduler/page.tsx`
- [ ] 9.2 Instagram checkbox only rendered/selectable when `/api/connections/status` reports `instagram: true`
- [ ] 9.3 Instagram checkbox enabled for both `contentType: "video"` and `contentType: "photo"` cards — pending final confirmation of design.md Open Question 4, disabled on a photo card once more than 1 photo is staged (recommended behavior, not yet confirmed)
- [ ] 9.4 `POST /api/posts` accepts `platform: "instagram"` alongside existing validation branches
