## Context

Reference implementation already shipped for YouTube:
- `app/api/connections/youtube/start/route.ts` — builds the Google auth URL, sets a CSRF state cookie.
- `app/api/connections/youtube/callback/route.ts` — verifies state, exchanges `code`, upserts `platform_tokens`.
- `app/api/connections/youtube/route.ts` — `DELETE` disconnect.
- `app/api/connections/status/route.ts` — reports which platforms are connected.
- `lib/youtube.ts` — provider REST/SDK calls, used at publish time (not connect time).
- `app/(app)/dashboard/settings/ConnectionsTab.tsx` — connect/disconnect UI.

`platform_tokens` (not in `supabase/migrations/`; lineage in `scripts/migrations/001-remap-users-to-supabase-auth.sql`, FK'd to `auth.users.id`) stores one row per `(user_id, platform)`: `user_id, platform, access_token, refresh_token, expires_at`. The existing `onConflict: "user_id,platform"` upsert is generic enough for `platform: "tiktok"` with no schema change.

TikTok has no official Node SDK — all calls are raw REST (`fetch`), consistent with this repo's existing style (`lib/youtube.ts` already uses native `fetch` for its video-download leg; there's no `axios` dependency). No `TIKTOK_*` env vars, config, or code currently exist anywhere in the codebase.

## Goals / Non-Goals

**Goals:**
- Let a signed-in user authorize Krakatoa to access their TikTok account via TikTok's OAuth (Login Kit), independent of their login session (Model B, matching YouTube).
- Persist `access_token` / `refresh_token` / `expires_at` in `platform_tokens` under `platform: "tiktok"`.
- Let the user disconnect (delete the stored row).
- Do a best-effort, non-blocking validation immediately after connecting (Creator Info query) to catch obvious misconfiguration (missing scope, Sandbox Target User not added) early.

**Non-Goals:**
- No actual publish/posting logic (Init Direct Post, chunked upload) — future change.
- No scheduler/cron integration for TikTok.
- No production/App-Review-only capabilities — Sandbox + Target Users only.
- No change to the login/session system or `lib/auth.ts`.
- No fix to the stale `profile-settings` OpenSpec docs (flagged only, see proposal.md).

## Decisions

### 1. Mirror YouTube's Model B shape exactly, not a shared abstraction
Three new routes (`start` / `callback` / `DELETE`) parallel to YouTube's, rather than a generic `connections/[platform]` dynamic route. The two providers' OAuth mechanics differ enough (TikTok's `client_key` naming, form-encoded token endpoint, rotating refresh tokens) that a shared abstraction would need provider-specific branches anyway — duplication here is cheaper than a premature abstraction. Revisit if a third platform connect is proposed.

### 2. CSRF: identical cookie pattern, new cookie name
`crypto.randomUUID()` state → httpOnly cookie `tiktok_oauth_state` (`maxAge: 300`, `sameSite: lax`, `path: "/"`), compared against the callback's `state` query param before touching `code`, cleared via a local `clearState()` helper on every exit path — copied verbatim from `youtube/callback`'s pattern.

### 2b. Origin resolution via Host header, not `request.url` (discovered during local testing)
Local testing behind an ngrok tunnel showed `redirect_uri` always resolving to `http://localhost:3000` regardless of the tunnel domain actually used — a known Next.js dev-server quirk where `new URL(request.url).origin` reports the dev server's own bind address rather than the incoming `Host` header. Added `resolveOrigin(request)` in `lib/tiktok.ts`, used by both `start` and `callback`, which reads `Host` + `X-Forwarded-Proto` directly. Production behavior is unchanged (Vercel sets both headers to match the real request), so this only fixes local/tunnel testing — it does not touch `youtube/{start,callback}`, which keep their original pattern.

### 2a. PKCE (discovered during implementation, not in original research)
Live testing against the registered Kelolako app showed TikTok rejects the authorize request outright ("出错了 ... code_challenge") without a PKCE challenge — this app registration mandates PKCE, which the original API research (based on the older non-PKCE Login Kit flow) didn't anticipate. Added: `start/route.ts` generates a `code_verifier` (`randomBytes(32).toString("base64url")`) and derives `code_challenge = sha256(code_verifier)` (also base64url), sent as `code_challenge` + `code_challenge_method=S256` on the authorize URL. The verifier is stored in a second httpOnly cookie, `tiktok_code_verifier` (same `maxAge`/`sameSite`/`path` as the state cookie), read back in `callback` and passed to `exchangeCodeForToken` as `code_verifier` in the token request body. `clearState()` now clears both cookies on every exit path. `client_secret` is still sent alongside PKCE params (this is a confidential/server-side client, not a public client, so both are valid together).

### 3. Token storage: same upsert shape, `platform: "tiktok"`
No schema change. `expires_at` computed from TikTok's `expires_in` (seconds → absolute ISO timestamp), matching the spirit of YouTube's `expiry_date` conversion.

### 4. `lib/tiktok.ts` owns REST mechanics; routes own orchestration
Three exported functions to start:
- `exchangeCodeForToken(code, redirectUri)` — `POST https://open.tiktokapi.com/v2/oauth/token/`, form-encoded body (`client_key`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`).
- `refreshAccessToken(refreshToken)` — same endpoint, `grant_type=refresh_token`; returns the full new token payload, including the rotated `refresh_token`, to the caller (see Decision 5) rather than assuming the old one stays valid.
- `getCreatorInfo(accessToken)` — `POST .../v2/post/publish/creator_info/query/`, Bearer auth.

No publish/init function is added in this change — deliberately, to keep the surface matching "Connect only."

### 5. Rotating refresh tokens — hard constraint for future publish work
TikTok's refresh endpoint invalidates the old `refresh_token` and returns a new one on every call. This is fundamentally different from Google's, which `lib/youtube.ts`'s `uploadToYouTube()` relies on being stable/reusable — it never writes back to `platform_tokens`. This change doesn't call `refreshAccessToken()` at runtime yet (nothing publishes), but designs for it now: `refreshAccessToken()`'s return type explicitly surfaces the new `refresh_token` (not just `access_token`), so the future scheduler/publish change cannot miss it.

**Hard requirement for that future change:** it MUST upsert the new `refresh_token` into `platform_tokens` immediately after every refresh call, or the next scheduled post will fail with an invalidated token. Documented here so it isn't rediscovered the hard way in production.

### 6. Connect-time validation: best-effort Creator Info fetch, never blocking
After the `platform_tokens` upsert succeeds, `callback` calls `getCreatorInfo()` inside a try/catch; on failure it only `console.warn`s and still redirects to the success path — mirrors `youtube/callback`'s existing convention of warning-and-continuing when Google's response omits a `refresh_token`, rather than failing the whole connect over a secondary signal. Purpose: surface scope/Sandbox-Target-User misconfiguration in logs immediately, rather than at first scheduled post inside a cron job (a much worse failure mode).

### 7. Error convention: unchanged, extended
All failure exits redirect to `${origin}/dashboard/settings?tab=connections&error=<code>`. Reuses `invalid_state`; adds `tiktok_connect_failed` for TikTok-specific failures (token exchange error, missing code, upsert failure) — parallel to `youtube_connect_failed`.

## Risks / Trade-offs

- **Sandbox constraints:** only pre-approved Target User accounts can complete the flow until App Review passes — acceptable for this phase, an existing constraint on the wider TikTok integration, not introduced by this change.
- **API specifics not SDK-checked:** endpoint paths, param names, and token lifetimes in this design come from TikTok for Developers documentation as researched, not from a typed SDK. Recommend a quick doc diff against the current Developer Portal during implementation in case endpoints have shifted.
- **No shared abstraction (Decision 1):** a third platform connect still won't have a shared base to reach for. Acceptable now; revisit if/when proposed.

## Alternatives Considered

- **Generic `app/api/connections/[platform]/{start,callback}/route.ts` dynamic route** — rejected for now: YouTube's existing routes aren't structured this way, retrofitting them is out of scope for a TikTok-only change, and it would still need provider branches internally given the OAuth mechanic differences.
- **Persisting the Creator Info response (privacy options, max duration) at connect time** — rejected: nothing consumes it yet (publish work is out of scope), so persisting it now is speculative; the future publish change can re-fetch it live since TikTok's API requires querying Creator Info at publish time regardless.
