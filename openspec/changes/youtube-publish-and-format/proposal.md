## Why

Two gaps remain after `youtube-format-modes` (Phase 1):

1. **Nothing actually publishes publicly.** `lib/youtube.ts` hardcodes `privacyStatus: "unlisted"` (with a literal "change to public for production" comment). So every scheduled video uploads as link-only — not in feed, search, or recommendations. The product's whole promise is "publish on autopilot," so this is the core gap. We verified the API **honors the requested privacy** (existing test uploads appear as Unlisted, not force-locked to Private), which means the Google Cloud project is **not** subject to the unverified-project private lock — flipping `"unlisted"` → `"public"` will take effect. The unverified-app status only costs the consent warning + 100-user cap (a future scale concern), not the ability to go public.

2. **Format isn't persisted.** Phase 1 tracks Short vs Video only in client state and reinforces it by appending `#Shorts` to the description. There's no server-side record of which posts were Shorts vs Videos, so no analytics and no durable source of truth.

## What Changes

- **Global publish visibility → `public`.** Change the single hardcoded `privacyStatus` in `lib/youtube.ts` from `"unlisted"` to `"public"`. No per-post control (content creators always intend public).
- **Persist `posts.format`.** Add a nullable `format` column (`'short' | 'video'`) via migration. The scheduler sends the chosen format on `POST /api/posts` (single + bulk); the API validates and stores it. Legacy posts stay `null` (= unknown).

## Capabilities

### New Capabilities

- `youtube-publish-and-format`: Scheduled YouTube uploads publish as public, and each post records its Short/Video format for tracking.

### Modified Capabilities

- _(builds on `youtube-format-modes`; the client-side `#Shorts` append is retained as-is.)_

## Impact

- **Backend:** `lib/youtube.ts` (one-line privacy flip); `app/api/posts/route.ts` (accept + validate + store `format`).
- **Frontend:** `app/(app)/tools/scheduler/page.tsx` (include `format` in the single + bulk schedule POST bodies).
- **DB:** `supabase/migrations/012_posts_format.sql` (additive, idempotent — `add column if not exists`).
- **Out of scope (deferred):** per-post visibility selector, moving `#Shorts` tagging server-side, OAuth verification / YouTube API audit (only needed to remove the unverified warning + 100-user cap, not to publish).
- **Risk:** flipping to `public` means scheduled posts go live publicly the moment cron runs. Mitigation: confirmed via the Unlisted-honored check; a manual "schedule one real public post and verify" step is included before trusting it broadly.
