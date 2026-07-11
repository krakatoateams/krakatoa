# Tasks

## 1. Env & credentials
- [ ] 1.1 Add `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` to `.env.local` (values from the TikTok Developer Portal → Credentials)
- [ ] 1.2 Add the same two vars to the Vercel project environment
- [ ] 1.3 Confirm the redirect URI `https://krakatoa-rho.vercel.app/api/connections/tiktok/callback` is registered in the TikTok app config, and that Sandbox Target Users include the accounts used for testing

## 2. `lib/tiktok.ts`
- [x] 2.1 `exchangeCodeForToken(code, redirectUri)` — `POST https://open.tiktokapi.com/v2/oauth/token/`, form-encoded body (`client_key`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`); return `{ accessToken, refreshToken, expiresIn, ... }`
- [x] 2.2 `refreshAccessToken(refreshToken)` — same endpoint, `grant_type=refresh_token`; return type must surface the new `refreshToken` explicitly (documents the rotation constraint for future callers)
- [x] 2.3 `getCreatorInfo(accessToken)` — `POST https://open.tiktokapi.com/v2/post/publish/creator_info/query/` with Bearer auth; return parsed JSON or throw on non-2xx

## 3. Connect routes
- [x] 3.1 `app/api/connections/tiktok/start/route.ts` — build TikTok's `/v2/auth/authorize/` URL (`client_key`, `scope=user.info.basic,video.publish`, `response_type=code`, `redirect_uri`, `state`), set `tiktok_oauth_state` cookie (httpOnly, `maxAge: 300`, `sameSite: lax`, `path: "/"`), redirect
- [x] 3.1a (discovered live) Add PKCE — generate `code_verifier`/`code_challenge` (S256), append `code_challenge`/`code_challenge_method` to the authorize URL, store the verifier in a `tiktok_code_verifier` cookie (same options as the state cookie). Required: this app registration rejects the authorize request without it.
- [x] 3.2 `app/api/connections/tiktok/callback/route.ts` — verify `state` against the cookie before reading `code`; on any failure redirect to settings with `error=tiktok_connect_failed` or `error=invalid_state`; on success read the `code_verifier` cookie, call `exchangeCodeForToken(code, redirectUri, codeVerifier)`, upsert `platform_tokens` (`platform: "tiktok"`, `onConflict: "user_id,platform"`), best-effort `getCreatorInfo` in a try/catch (log only), clear both cookies on every exit path, redirect to settings
- [x] 3.3 `app/api/connections/tiktok/route.ts` — `DELETE` handler removing the `platform_tokens` row for `(user_id, "tiktok")`, mirroring the YouTube disconnect route

## 4. Status & UI
- [x] 4.1 `app/api/connections/status/route.ts` — add `tiktok: connected.has("tiktok")` to the response
- [x] 4.2 `ConnectionsTab.tsx` — promote the TikTok stub row (`Music2` icon) from `StaticConnectionRow status="soon"` to the interactive connect/disconnect block; add `tiktokConnected` state, fetch from `/api/connections/status`, wire the Connect link to `/api/connections/tiktok/start`, wire disconnect to `DELETE /api/connections/tiktok`, and handle `tiktok_connect_failed` / `invalid_state` redirect-back error params

## 5. Verification
- [x] 5.1 `npx tsc --noEmit` passes
- [x] 5.2 Lint clean on new/edited files
- [ ] 5.3 Manual (Sandbox): connect a Target User TikTok account end-to-end; confirm a `platform_tokens` row is created with `platform="tiktok"` and a non-null `refresh_token`; confirm the best-effort Creator Info call logs success (or a clearly-logged, non-blocking failure)
- [ ] 5.4 Manual: disconnect; confirm the row is deleted and `ConnectionsTab` reverts to the "Connect" state
