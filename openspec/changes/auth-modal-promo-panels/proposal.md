## Why

The auth modal (`SignInModal`/`SignUpForm` inside `AuthModalShell`) is a bare, single-column card today — no promotional content, no indication of what's on offer, identical for a brand-new visitor and a returning user. A reference competitor screen showed a split layout (auth form + a promo panel showcasing the product) and prompted the question: could Kelolako's own auth modal nudge people the same way, on the side we actually want.

Two things make this worth doing now rather than "someday":
- Kelolako already has a working, admin-configurable "give new users starter credits" mechanism (`welcome_bonus_settings`) that is currently switched **off** — so today's modal can't honestly say "generate for free" even though the plumbing to make it true already exists.
- The full-page `/login`/`/signup` routes (`AuthLayout.tsx`) already run a rotating model showreel (`lib/landing-media.ts`'s `LANDING_SHOWREEL`) that the in-app modal never reuses — there's already-built, already-proven promo content sitting one component away.

## What Changes

- **Split-layout auth modal**: a promo panel + the existing auth form, side by side (promo panel on the **left**, form on the **right** — mirrored from the reference, which had it the other way around; see design.md for the open question on why).
- **Sign-up mode promo content**: "Register now and generate for free"-style copy, backed by re-enabling `welcome_bonus_settings` with `credit_amount` sized to exactly the cost of the cheapest available video generation (not a round number) — a bounded "one free taste," not a general credit pile.
- **Sign-in mode promo content**: "see what Kelolako can do" — reuses the existing `LANDING_SHOWREEL` rotating model showcase already running on `/login`/`/signup`, ported into the modal. Not framed as "what's new" (no recency/changelog data exists anywhere in the codebase to back that claim honestly).
- **Admin credit toggle**: re-enable the welcome bonus at the new, tightly-scoped amount via the existing `/admin/pricing` UI — no new backend/table/API needed, it already exists.

### Explicitly out of scope (deferred to a possible follow-up change)

A "redirect a brand-new user straight into a pre-filled video-generation composer, they just click Generate" flow was considered during exploration and dropped from this change. It needs real new engineering that doesn't exist yet: no new-user/zero-generations detection anywhere (`Profile.onboarding_completed` is a dead, unused column), and the `/tools/video` deep-link params only select which composer opens, not engine/resolution/duration — there's no settings-pre-fill mechanism to redirect into. The flagship tool (Reels Creator) is also currently admin-gated only. This change is the modal + the credit toggle; the guided-first-generation flow is a separate, larger piece of work if pursued later.

## Capabilities

### New Capabilities

- `auth-modal-promo-panels`: A split-layout auth modal with mode-specific promotional content (sign-up: free-credit nudge; sign-in: model showcase), backed by the existing (currently disabled) welcome-bonus credit grant.

## Impact

- **Frontend:** `components/auth/AuthModalShell.tsx`, `components/auth/SignInModal.tsx`, `components/auth/SignUpForm.tsx` — layout restructure to two-column, mode-aware. Likely reuses/extracts pieces of `components/auth/AuthLayout.tsx` (the showreel panel) rather than rebuilding it.
- **Content:** `lib/landing-media.ts`'s `LANDING_SHOWREEL` reused as-is for sign-in; new copy needed for sign-up's free-credit panel.
- **Admin/config:** `welcome_bonus_settings` row toggled on with a new `credit_amount` via the existing `/admin/pricing` UI — a data change, not a schema/code change.
- **Dependencies:** none — both the credit-grant mechanism and the showreel content already exist and are already live elsewhere in the app; this change is primarily UI composition + one admin-panel setting.
- **Risk:** low. No new backend surface, no new data model, no change to auth logic itself (Google/email sign-up/sign-in flows are untouched — only the surrounding chrome changes). Main risk is copy/promise accuracy (see design.md's "existing user sees sign-up copy" edge case, already confirmed safe) and mobile layout handling of a new two-column shape.
