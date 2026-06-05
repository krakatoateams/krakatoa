## Context

Krakatoa is a Next.js 14 App Router app with NextAuth (Google) auth, Supabase Postgres/Storage, Tailwind, and Lucide. The authenticated shell lives under the `(app)` route group ([`app/(app)/layout.tsx`](app/(app)/layout.tsx)), which wraps every page in `SessionProvider`, `CreditBalanceProvider`, and the sidebar. Auth is enforced by `middleware.ts` (`matcher: ["/dashboard/:path*", "/tools/:path*"]`).

The only account UI today is the inline user card in [`app/(app)/dashboard/Sidebar.tsx`](app/(app)/dashboard/Sidebar.tsx) (lines 105-141). Three independent identity/data realities shaped this design:

1. **Auth and YouTube are one fused OAuth grant.** Google login requests `youtube.upload` and writes a single `platform_tokens` row ([`lib/auth.ts`](lib/auth.ts)). The scheduler shows "YouTube Connected" purely from `status === "authenticated"`.
2. **Identity is split across two keys.** Credits/jobs/the `assets` table are keyed by `profile_id` ([`lib/profiles-db.ts`](lib/profiles-db.ts), [`lib/credits-db.ts`](lib/credits-db.ts)); the legacy creations history is keyed by `user_id` ([`lib/resolve-user.ts`](lib/resolve-user.ts), `app/api/creations/history/route.ts`).
3. **Profile fields have no read path.** `profiles.display_name` / `avatar_url` exist but the UI reads `session.user.name` / `session.user.image` (Google) everywhere.

## Goals / Non-Goals

**Goals:**
- A discoverable Profile Settings surface at `/dashboard/settings` with five tabs.
- Reach it by clicking the sidebar user card (plus a nav link), without breaking the existing sign-out button.
- Make Account, Credits, and Assets genuinely functional with minimal new backend (one read-only endpoint).
- Present Connections honestly given the current fused-auth reality; show IG/TikTok and credit purchases as clearly-disabled "Coming soon".

**Non-Goals:**
- Editing profile fields (display name/avatar). Stub only.
- Decoupled per-platform social connections / multiple accounts ("Model B").
- Any payment-gateway integration.
- Migrating the `user_id` vs `profile_id` split or moving assets history onto the new `assets` table.

## Decisions

### Decision 1: Dedicated page with client-side tabs, not a modal
A `/dashboard/settings` page (a route, not an overlay) holds five tabs. Chosen over a modal because five sections with tables/lists need room and a stable URL. It sits inside `(app)`, so it inherits auth, sidebar, and the credit context for free.

Alternative considered: sidebar modal — rejected (cramped, not linkable).

### Decision 2: Tabs are URL-addressable via `?tab=` query param
Tab state syncs to a `?tab=<account|credits|connections|assets|settings>` query param so the sidebar credit pill can deep-link straight to the Credits tab and tabs are shareable/back-button friendly. Chosen over pure local state (can't deep-link) and over nested routes `/dashboard/settings/credits` (more files, more boilerplate for v1).

### Decision 3: Entry point = clickable card + isolated sign-out + nav link ("Option C")
The user card content (avatar/name/email/credit badge) becomes a `Link` to `/dashboard/settings`. The existing sign-out `<button>` stays a sibling outside the Link so the two targets never conflict. A "Settings" item is also added to the sidebar `SECTIONS` array for explicit discoverability. Chosen over a nav-link-only approach because the user card is the most intuitive place users look to manage their account.

### Decision 4: Connections tab uses "Model A, honest"
Because login and the YouTube grant are a single OAuth grant, the tab shows a read-only "Signed in with Google — YouTube publishing enabled" state derived from the session, with no disconnect action (disconnecting would delete the only login token). Instagram and TikTok are disabled "Coming soon" cards. This avoids shipping a misleading disconnect button or implying multi-account support that does not exist.

Alternative considered: "Model B" (per-platform OAuth, multiple accounts, real connect/disconnect). Rejected for this pass — large new architecture (tables, callbacks, token lifecycle); captured as future scope.

### Decision 5: One new read-only backend endpoint
`GET /api/credits/transactions` resolves the profile via `requireCurrentProfile()` and returns `listCreditTransactions(profile.id, { limit })`, mirroring the 401-on-unauth behavior of `app/api/credits/balance/route.ts`. Both helpers already exist; no migrations. Everything else reuses existing endpoints/components (`/api/credits/balance`, `/api/creations/history`, `CreditBadge`, `CreationsHistory`).

### Decision 6: Assets tab reuses the legacy creations history
The Assets tab calls the existing `/api/creations/history` (keyed by `user_id`) for consistency with the dashboard's "Recent Creations", accepting the known `user_id`/`profile_id` split rather than migrating to the `assets` table now.

## Risks / Trade-offs

- **Misleading "connected" state** → Connections derives status from the session like the existing scheduler badge; we explicitly do NOT verify token validity, and we do NOT offer disconnect, so we never imply more than is true.
- **Sign-out vs card-link click conflict** → Keep the sign-out `<button>` as a sibling of the `Link` (not nested); the card link wraps only the identity area.
- **Stubs looking broken** → IG/TikTok, Buy Credits, and Basic Settings fields are rendered visibly disabled with explicit "Coming soon" copy, not hidden, so intent is clear.
- **Assets tab shows the legacy source of truth** → Accepted; documented so a later migration to the `assets` table is a deliberate follow-up, not a surprise.
- **Profile-field edits have no effect later without extra work** → Basic Settings stays a stub; making it real later requires an update API AND switching reads from session to `profiles` AND a session-refresh strategy — out of scope here.

## Open Questions

- None blocking. Future: when Model B is taken on, decide whether YouTube migrates off the fused login grant or stays as the "primary" account.
