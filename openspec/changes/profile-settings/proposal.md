## Why

Today the only account UI is the inline user card in the sidebar footer ([`app/(app)/dashboard/Sidebar.tsx`](app/(app)/dashboard/Sidebar.tsx) lines 105-141): it shows the Google name/email/avatar, a credit badge, and a sign-out icon — there is no way to open a Profile Settings surface. Users have nowhere to review their account, see their credit history, understand which social platform is connected for publishing, or browse their generated assets in one place.

## What Changes

- Add a dedicated, tabbed **Profile Settings** page at `/dashboard/settings` (inside the existing `(app)` shell, already covered by the `middleware.ts` auth matcher) with five sections: **Account**, **Credits**, **Connections**, **Assets**, **Basic Settings**.
- Make the sidebar user card a clickable entry point (Link to `/dashboard/settings`) while keeping the existing sign-out button as an isolated, separate click target; also add a **Settings** nav item.
- **Account** (functional): show Google session identity (avatar/name/email), "Signed in with Google", and sign out.
- **Credits** (functional + stub): show balance and lifetime stats from `GET /api/credits/balance`, plus a transaction-history list backed by a new read-only `GET /api/credits/transactions`. A "Buy credits" panel renders as a disabled **Coming soon** stub (no payment gateway yet).
- **Connections** (Model A, honest): present an accurate read-only view — "Signed in with Google — YouTube publishing enabled" (derived from session, consistent with the scheduler's existing `YouTubeStatusBadge`). Instagram and TikTok render as disabled **Coming soon** cards. No disconnect action is offered, because login and the YouTube grant are currently a single fused OAuth grant ([`lib/auth.ts`](lib/auth.ts) lines 17-22, 56-69) and a "disconnect" would break the user's only login.
- **Assets** (functional): list the user's generated assets by reusing the existing `GET /api/creations/history` ([`app/api/creations/history/route.ts`](app/api/creations/history/route.ts)) / `components/CreationsHistory.tsx`.
- **Basic Settings** (stub): show display name and avatar fields read-only / disabled with a **Coming soon** note. Intentionally not editable in this pass.

Out of scope (explicitly deferred):

- Editing `profiles.display_name` / `profiles.avatar_url` — there is currently no write API and no read path (all UI reads the NextAuth Google session, not the `profiles` table), so making this real later is a separate, multi-part change.
- Decoupled per-platform social connections ("Model B": independent OAuth grants for YouTube/Instagram/TikTok, multiple accounts per platform) — a larger architecture (new tables, per-platform callbacks, token lifecycle) deferred to a future change.
- Payment gateway / credit purchases (Xendit, etc.).

## Capabilities

### New Capabilities

- `profile-settings`: The Profile Settings page and its five tabs — route and entry points (clickable sidebar card + nav link), the Account/Credits/Connections/Assets/Basic Settings section behaviors, the new `GET /api/credits/transactions` read-only ledger endpoint, and the honest "Model A" framing of the Connections tab.

### Modified Capabilities

- _(none — no existing `openspec/specs/` baseline in-repo.)_

## Impact

- **Frontend:** New route `app/(app)/dashboard/settings/page.tsx` plus per-tab components colocated in that folder. Edit `app/(app)/dashboard/Sidebar.tsx` to make the user card a Link, isolate the sign-out button, and add a Settings nav item.
- **Backend:** New read-only route `app/api/credits/transactions/route.ts` using `requireCurrentProfile()` + `listCreditTransactions()` (both already exist in [`lib/profiles-db.ts`](lib/profiles-db.ts) and [`lib/credits-db.ts`](lib/credits-db.ts)), mirroring the 401-on-unauth pattern of `app/api/credits/balance/route.ts`. No DB migrations.
- **Reuse:** `CreditBadge`, `useCreditBalance` context, `CreationsHistory` / `/api/creations/history`, and the scheduler's YouTube-status framing.
- **Identity note:** Credits are keyed by `profile_id` while the reused assets history is keyed by `user_id` (legacy `user_creations`); the page intentionally accepts this existing split rather than migrating it.
