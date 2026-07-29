# Tasks

Phased per the confirmed decisions in `design.md`. **Phase 1 is this change's actual scope**; Phases 2–4 are recorded here for continuity but implemented in later changes.

## Phase 1 — OAuth connect/disconnect only

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
- [ ] 3.5 Container/publish functions (`createMediaContainer`, `getContainerStatus`, `publishContainer`) — **Phase 2**, not implemented yet
- [ ] 3.6 `isInstagramPermanentFailure` — **Phase 2**, not implemented yet (only meaningful once publish exists)

### 4. Connect routes
- [x] 4.1 `app/api/connections/instagram/start/route.ts` — build `https://www.instagram.com/oauth/authorize` (`client_id`, `redirect_uri`, `response_type=code`, `scope=instagram_business_basic,instagram_business_content_publish`, `state`) using `resolveOrigin` from `lib/http.ts`, set an `instagram_oauth_state` cookie (httpOnly, `maxAge: 300`, `sameSite: lax`, `path: "/"`), redirect
- [x] 4.2 `app/api/connections/instagram/callback/route.ts` — verify `state` against the cookie before reading `code`; on success call `exchangeCodeForToken`, reject (no `platform_tokens` write) with `error=instagram_not_business_account` if `instagram_business_content_publish` is missing from the granted `permissions`, otherwise call `exchangeForLongLivedToken` and upsert `platform_tokens` (`platform: "instagram"`, `refresh_token: null`, `onConflict: "user_id,platform"`); on any other failure redirect with `error=instagram_connect_failed` or `error=invalid_state`; clear the state cookie on every exit path
- [x] 4.3 `app/api/connections/instagram/route.ts` — `DELETE` handler removing the `platform_tokens` row for `(user_id, "instagram")`, mirroring the YouTube/TikTok disconnect routes

### 5. Status & UI
- [x] 5.1 `app/api/connections/status/route.ts` — add `instagram: connected.has("instagram")` to the response
- [x] 5.2 `ConnectionsTab.tsx` — promote the Instagram stub row (`Camera` icon) from `StaticConnectionRow status="soon"` to the interactive connect/disconnect block; add `instagramConnected` state, fetch from `/api/connections/status`, wire Connect to `/api/connections/instagram/start`, wire disconnect to `DELETE /api/connections/instagram`, handle `instagram_connect_failed` / `instagram_not_business_account` / `invalid_state` redirect-back errors

### 6. Verification
- [x] 6.1 `npx tsc --noEmit` passes
- [x] 6.2 Lint clean on new/edited files
- [ ] 6.3 (User action, manual) Connect a Business/Creator Instagram account end-to-end; confirm a `platform_tokens` row is created with `platform="instagram"`, a non-null `access_token`, `refresh_token` null, and a ~60-day `expires_at`
- [ ] 6.4 (User action, manual) Attempt connecting a Personal (non-Business/Creator) account if feasible; confirm the flow is rejected with `instagram_not_business_account` and no `platform_tokens` row is written — this is also the empirical check design.md Decision 12 flags as unconfirmed (whether Meta's own authorize step already blocks Personal accounts, vs. relying solely on our permissions check)
- [ ] 6.5 (User action, manual) Disconnect; confirm the row is deleted and `ConnectionsTab` reverts to the "Connect" state

## Phase 2 — Publish flow (future change, not this one)
- [ ] 7.1 New additive migration: `posts.instagram_container_id`, `posts.instagram_media_id` (design.md Decision 5)
- [ ] 7.2 `lib/instagram.ts`: `createMediaContainer`, `getContainerStatus`, `publishContainer`, `isInstagramPermanentFailure`
- [ ] 7.3 New `if (post.platform === "instagram")` branch in `app/api/cron/route.ts`: idempotency short-circuit on `instagram_media_id`; else create-or-resume container, exactly one status check per tick (design.md Decision 4), branch on `FINISHED`/`IN_PROGRESS`/`ERROR`/`EXPIRED`
- [ ] 7.4 10-minute wall-clock give-up threshold (design.md Decision 6) — decide the exact timestamp field during this phase's migration
- [ ] 7.5 Reuse `signStoragePathForPublish`/`resolvePublishVideoUrl` for both photo and video containers (design.md Decision 7) — verify empirically, no proxy route unless testing proves one is needed

## Phase 3 — Proactive token refresh (future change, not this one)
- [ ] 8.1 `lib/instagram.ts`: `refreshLongLivedToken` (design.md Decision 2, endpoint already researched)
- [ ] 8.2 New daily cron route selecting `platform_tokens` rows (`platform = "instagram"`) with `expires_at` inside the next 7–14 days, calling `refreshLongLivedToken` and persisting the result (design.md Decision 2b)
- [ ] 8.3 Register the cron in `vercel.json`, matching the existing native-cron convention

## Phase 4 — Scheduler UI (future change, not this one; depends on Phase 2)
- [ ] 9.1 Widen `platforms: Array<"youtube" | "tiktok">` to include `"instagram"` everywhere the union is spelled out in `app/(app)/tools/scheduler/page.tsx`
- [ ] 9.2 Instagram checkbox only rendered/selectable when `/api/connections/status` reports `instagram: true`
- [ ] 9.3 Instagram checkbox enabled for both `contentType: "video"` and `contentType: "photo"` cards — pending final confirmation of design.md Open Question 4, disabled on a photo card once more than 1 photo is staged (recommended behavior, not yet confirmed)
- [ ] 9.4 `POST /api/posts` accepts `platform: "instagram"` alongside existing validation branches
