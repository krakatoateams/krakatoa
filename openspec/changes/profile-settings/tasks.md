## 1. Backend: credit transactions endpoint

- [x] 1.1 Add `app/api/credits/transactions/route.ts` with `export const dynamic = "force-dynamic"` and a `GET` handler
- [x] 1.2 Resolve the profile via `requireCurrentProfile()`; return `{ items }` from `listCreditTransactions(profile.id, { limit })` (default/cap the limit)
- [x] 1.3 Return HTTP 401 on "not authenticated" and HTTP 500 on other errors, mirroring `app/api/credits/balance/route.ts`

## 2. Settings page shell

- [x] 2.1 Create `app/(app)/dashboard/settings/page.tsx` as a client component with five tabs (Account, Credits, Connections, Assets, Basic Settings)
- [x] 2.2 Sync the active tab to a `?tab=` query param (`account|credits|connections|assets|settings`), defaulting to Account when absent/invalid
- [x] 2.3 Build the page layout (left/top tab nav + content panel) using the app's dark Tailwind + Lucide styling

## 3. Tab: Account

- [x] 3.1 Render session avatar (or initial fallback), name, and email from `useSession()`
- [x] 3.2 Show "Signed in with Google" and a sign-out button calling `signOut({ callbackUrl: "/" })`

## 4. Tab: Credits

- [x] 4.1 Fetch and display balance + lifetime purchased/spent from `GET /api/credits/balance` (reuse `useCreditBalance` where helpful)
- [x] 4.2 Fetch `GET /api/credits/transactions` and render a newest-first history list (type, signed amount/direction, created_at)
- [x] 4.3 Add a visibly disabled "Buy credits — Coming soon" panel with no purchase action

## 5. Tab: Connections (Model A, honest)

- [x] 5.1 Render a read-only YouTube/Google card from session status ("Signed in with Google — YouTube publishing enabled"), with NO disconnect control
- [x] 5.2 Render Instagram and TikTok as disabled "Coming soon" cards that trigger no OAuth flow

## 6. Tab: Assets

- [x] 6.1 List the user's generated assets by reusing `components/CreationsHistory.tsx` / `GET /api/creations/history`
- [x] 6.2 Ensure a clean empty state for users with no creations

## 7. Tab: Basic Settings (stub)

- [x] 7.1 Render display name and avatar as disabled/read-only fields with a "Coming soon" note; no persistence

## 8. Sidebar entry points

- [x] 8.1 Wrap the user-card identity area (avatar/name/email/credit badge) in a `Link` to `/dashboard/settings` in `app/(app)/dashboard/Sidebar.tsx`
- [x] 8.2 Keep the sign-out `<button>` as an isolated sibling (outside the Link) so it signs out without navigating
- [x] 8.3 Add a "Settings" nav item (Lucide `Settings` icon) to the sidebar `SECTIONS`

## 9. Verification

- [x] 9.1 Lint/type check: `npm run lint` has a PRE-EXISTING config crash (`.eslintrc.json` circular structure, out of scope to fix). Verified all new/edited files are clean via `npx tsc --noEmit` (exit 0) and the editor linter (no errors). Fixed one real type error found: `lucide-react@1.16.0` lacks `Youtube`/`Instagram` exports → switched to `Video`/`Camera`.
- [x] 9.2 Verified by code review: `?tab=` parsing defaults to Account on missing/invalid; sidebar card Link vs isolated sign-out button; new endpoint returns 401 on "not authenticated" mirroring the balance route.
