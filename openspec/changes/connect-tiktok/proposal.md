## Why

The Connections tab (`app/(app)/dashboard/settings/ConnectionsTab.tsx`) already reserves a TikTok row, but it's a static "Coming soon" stub with no backing OAuth flow — there's no way for a user to actually authorize their TikTok account, so there's no path to auto-publishing there even once the Content Posting API integration is built.

The TikTok app is already registered (Kelolako) with Login Kit + Content Posting API products, scopes `user.info.basic` + `video.publish`, a redirect URI to register (`https://krakatoa-rho.vercel.app/api/connections/tiktok/callback`), and credentials available in the TikTok Developer Portal. Nothing in the codebase consumes them yet.

The existing "Connect YouTube" flow already proved out an independent-OAuth-per-platform pattern (`app/api/connections/youtube/{start,callback}`, a DELETE disconnect route, and a generic `platform_tokens` table keyed by `(user_id, platform)`), decoupled from login. TikTok should follow that exact pattern rather than inventing a new one.

## What Changes

- New OAuth authorize/callback/disconnect routes for TikTok under `app/api/connections/tiktok/`, mirroring the YouTube trio's CSRF cookie handling, `platform_tokens` upsert shape, and settings-redirect error convention.
- New `lib/tiktok.ts` with raw-`fetch` helpers for TikTok's REST API (no official Node SDK exists): token exchange, refresh (surfacing the rotated `refresh_token` to its caller), and a Creator Info query. Explicitly **no** publish/init logic.
- `ConnectionsTab.tsx` promotes TikTok from a static "Coming soon" stub to an interactive connect/disconnect row, copying the YouTube row's state and UI pattern.
- `/api/connections/status` adds a `tiktok` boolean alongside `youtube`.
- New env vars `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`, provisioned in `.env.local` and Vercel (not committed).

## Capabilities

### New Capabilities
- `connect-tiktok`: users can authorize and revoke a TikTok account connection; tokens are persisted for a future publish change to consume.

### Modified Capabilities
- None formally modified. This extends the connections surface the `profile-settings` change introduced, using the OAuth pattern the YouTube connect routes already shipped (see documentation debt below).

## Impact

- **Backend:** 3 new route files (`start`, `callback`, `route.ts` DELETE) + 1 new lib helper (`lib/tiktok.ts`) + 1 modified route (`status`).
- **Frontend:** `ConnectionsTab.tsx`.
- **DB:** no migration — `platform_tokens` already generically supports arbitrary `platform` values (`onConflict: "user_id,platform"`).
- **Env:** 2 new secrets to provision outside code (`.env.local` + Vercel).
- **Out of scope (deferred):**
  - The actual publish-to-TikTok logic (Init Direct Post, chunked file upload, scheduler/cron integration) — a future change. This change only obtains and stores tokens.
  - Passing TikTok App Review / production access — this change targets Sandbox mode with manually-added Target Users, the constraint already governing the wider TikTok integration.
- **Known documentation debt (not fixed here):** `openspec/changes/profile-settings/` (`proposal.md`, `design.md`, `specs/profile-settings/spec.md`) describes the Connections tab's YouTube entry as a single "fused" OAuth grant tied to login ("Model A"), with independent per-platform OAuth ("Model B") explicitly called out as deferred future work. The shipped code already implements Model B for YouTube (its own `OAuth2` client, its own `platform_tokens` row, connect/disconnect UI) — that spec is stale on this point. This change extends the already-shipped Model B pattern to TikTok; it does not update or reconcile the `profile-settings` artifacts.
