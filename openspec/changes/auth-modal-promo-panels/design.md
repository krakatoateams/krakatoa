## Context

The in-app auth modal (`components/auth/SignInModal.tsx` + `components/auth/SignUpForm.tsx`, chrome from `components/auth/AuthModalShell.tsx`, shared with `ResetPasswordModal`) is a bare centered card (`max-w-md`, single column) — no promotional/marketing content anywhere in it. It's reached via `useAuthModal()` → `openSignInModal()` / `openSignUpModal()` (`components/auth/AuthModalProvider.tsx`), which already distinguishes sign-in vs. sign-up mode — that distinction is the hook this whole design hangs off of.

Separately, `components/auth/AuthLayout.tsx` (used by the full-page `/login` and `/signup` routes) already renders a rotating model showreel sourced from `lib/landing-media.ts`'s `LANDING_SHOWREEL`: `{ model: "Nano Banana 2", src: ... }`, `{ model: "Kling 3", ... }`, `{ model: "Seedance 2", ... }`, plus one extra clip in rotation. This is proven, already-shipped content that the modal has simply never reused.

Separately again, `welcome_bonus_settings` (migration `053_welcome_bonus_settings.sql`, `lib/welcome-bonus-settings-db.ts`, admin UI at `/admin/pricing` → `app/(app)/admin/pricing/page.tsx`) is a real, working, admin-toggleable "grant new regular users N credits on signup" mechanism. It is currently `enabled = false`. Per team knowledge, a "100 credits to all new users" bonus existed before and was turned off at some point — consistent with this exact toggle, though there's no git history for it since it's a live data change, not code (the DB row does track `updated_by_profile_id`/`updated_at`, but neither field is surfaced in the admin UI today).

Regular (non-admin) users get **zero** credits by default — the 500-dummy-credit seed in the same trigger function is admin-only. So today, a brand-new signup literally cannot generate anything until this bonus is re-enabled (or credits are purchased, and no payment gateway is live yet).

## Goals / Non-Goals

**Goals:**
- Give the auth modal a split layout: promo panel + the existing auth form, content varying by sign-up vs. sign-in mode.
- Make the sign-up panel's "generate for free" claim literally true by re-enabling the existing welcome-bonus grant, sized to one cheap generation rather than a round giveaway number.
- Give the sign-in panel a re-engagement purpose ("see what we can do") without inventing a new content system — reuse `LANDING_SHOWREEL`.
- Keep the change additive/low-risk: no new tables, no new auth logic, no change to how Google/email sign-in actually works.

**Non-Goals:**
- No new-user/zero-generations detection or post-signup redirect-into-a-prefilled-composer flow (see proposal.md's "explicitly out of scope"). That's a distinct, larger change if pursued later.
- No literal "what's new" / changelog feature. No recency-tracking data exists anywhere in the codebase (`model_catalog_configs` timestamps reflect admin edits, not ship dates); the sign-in panel promises "our best models," not "our newest models."
- No changes to `SignUpForm`'s actual submission logic, duplicate-email handling, or NextAuth/Supabase Auth flows — only the surrounding layout/content.

## Decisions

### 1. Split layout: promo panel LEFT, auth form RIGHT

Mirrored from the reference design (which had promo on the right). The reasoning surfaced during exploration but not conclusively settled — see **Open Questions** below; capturing the decision to go left without fully resolving *why* left, since the visual direction was clear even though the justification wasn't nailed down.

### 2. Two content variants, keyed off existing sign-up/sign-in mode

`useAuthModal()` already distinguishes `openSignInModal()`/`openSignUpModal()` — no new mode-detection needed. The promo panel simply renders different content per mode:
- **Sign-up**: "Register now and generate for free" copy + whatever visual treatment accompanies it.
- **Sign-in**: the ported `LANDING_SHOWREEL` model showcase.

### 3. Sign-up's credit claim must be literally true — re-enable + resize the welcome bonus

Re-enable `welcome_bonus_settings.enabled = true`, and set `credit_amount` to the cost of the cheapest available video generation — not the old round number (100). This bounds the giveaway to "one free taste" rather than a general-purpose credit pile, while keeping the modal's copy honest. Exact target model/amount is an open question (see below) — candidates found during exploration: `seedance2mini_480p` at ~18 credits for 5s (cheapest found), or plain Seedance 480p/5s at ~32 credits (`lib/pricing-defaults.ts`).

This is a pure **data change** via the existing `/admin/pricing` UI — no code/schema change required for the grant mechanism itself.

### 4. Sign-in's content is "our best," not "what's new" — reuse `LANDING_SHOWREEL` as-is

No new curation system. Port the existing showreel component/data from `AuthLayout.tsx` into the modal. Whether it's a direct component reuse or needs adapting for the modal's (likely smaller) panel size is an open question (see below).

### 5. Existing-user-lands-on-sign-up-modal edge case — confirmed safe, no change needed

Investigated during exploration: if an existing user mistakenly submits the sign-up form, there's no auto-redirect to sign-in today (`SignUpForm.tsx` shows an inline "already registered — log in here" error with a manual link/button). This does **not** risk a double credit-grant regardless of what modal copy they saw, because:
- `getOrCreateProfileFromSupabaseAuth()` (`lib/profiles-db.ts:168-199`) always looks up the existing profile first and never re-inserts for an existing `user_id`.
- Even a concurrent-request race re-fetches on a unique-constraint conflict rather than duplicating.
- The grant trigger is `AFTER INSERT` only (structurally can't fire on an existing row) and additionally carries idempotency key `seed:welcome_bonus:{id}`.

No fix required here — noted as confirmed-safe so it isn't re-litigated during implementation. A minor UX polish (making the "already have an account? log in" link more prominent) is optional, not required.

## Open Questions — resolved during apply

1. **Welcome-bonus amount: ~~~32~~~ 10 credits.** Originally estimated at ~32cr from the code fallback (`lib/pricing-defaults.ts`) sized to plain Seedance 480p/5s. **Superseded**: pulling the live `pricing_configs`/`billing_settings` rows directly from Supabase (see the `welcome-video-offer` follow-up change) showed the code fallback had drifted from reality — the actual cheapest live video config is Seedance 1 Pro Fast, 480p, 5s, no audio, at 2 credits/sec × 5s = **10 credits**. That follow-up change also pins the welcome-video Skill to this exact model/resolution so the advertised number and the actual cost always match.

2. **Showreel source: port `HelloHero.tsx`'s named model-strip, not `AuthLayout.tsx`.** Checked both directly: `AuthLayout.tsx` (used by `/login`/`/signup`) only cycles background video via `LANDING_VIDEO_SRCS` — no model names shown anywhere, just ambient looping video. The actual named, clickable model-strip UI ("Doubles as the playlist selector: each model plays its own clip") lives in `components/landing-hello/HelloHero.tsx`, built on `LANDING_SHOWREEL`. **Correction to the original design assumption** (which said `AuthLayout` already does this) — it doesn't; `HelloHero` does. Implementation needs to extract the strip+clip-swap logic from `HelloHero.tsx` into a smaller, modal-sized component, not import `AuthLayout` wholesale.

3. **`LANDING_SHOWREEL` mismatch confirmed and fixed: drop "Nano Banana 2."** `LANDING_SHOWREEL` pairs "Nano Banana 2" with a video clip (the barista clip, itself only a stand-in — no real Nano Banana 2 clip exists), but Nano Banana 2 (`google/nano-banana-2`, `lib/product-photo.ts`) is a **Product Photo image model** — it doesn't do video at all. Showing it in a "these are our video models" panel would be factually wrong, not just stale. The modal's version of the showreel uses only the two entries that are real, live video models: **Kling v3** (confirmed live at `lib/video-models.ts:442-444`, id `kling_v3`) and **Seedance 2**. This is a deliberate divergence from `LANDING_SHOWREEL` as it stands on the landing page — not a bug to fix there, just don't carry the mismatch into new surface area.

4. **Left placement is about mobile stacking order**, confirmed: the promo panel should be the block that ends up on top when the two-column layout collapses to one column on narrow viewports, so the hook is seen first. This should directly inform the responsive implementation (task 3.3) — the DOM/flex order should put the promo panel first regardless of the visual left/right split at desktop width, so a simple column-reverse or source-order choice naturally produces "promo on top" on mobile without extra media-query logic.

5. **Existing-user sign-up edge case (previously Decision 5):** confirmed safe mechanically; the optional "make the login link more prominent" polish (task 6.1) stays optional, not required for this change.

## Risks / Trade-offs

- **Copy accuracy over time**: "generate for free" is only honest while the welcome bonus stays enabled at a nonzero amount. Since it's a live admin toggle, someone could disable it again without touching this modal's code, silently making the copy false. No code-level safeguard proposed here (e.g. conditionally rendering the free-credit copy only when the bonus is actually enabled) — worth deciding whether the modal should read live settings rather than hardcoding the promise as static copy.
- **Two-column layout on mobile**: current modal is single-column/bare; introducing a promo panel means new responsive behavior to get right (stack order, whether the promo panel shows at all on small screens or collapses away).
- **Scope creep risk**: the deferred "pre-filled first generation" flow is a natural next thing people will want once this ships and the free credit is real — worth explicitly re-stating the boundary during implementation so this change doesn't quietly grow into that one.

## Alternatives Considered

- **Post-signup redirect into a pre-filled generation composer** ("just click Generate") — the original, more ambitious version of this idea. Rejected for *this* change due to missing infrastructure (no new-user detection, no settings-pre-fill deep-link support, Reels Creator admin-gated). Left as a possible follow-up change, not folded in here.
- **Build a real "what's new" system** (changelog/featured-flag) to back the sign-in panel's re-engagement goal literally. Rejected as disproportionate scope for what the sign-in panel needs — reusing the existing showreel achieves the re-engagement goal without new data infrastructure.
- **Keep the round 100-credit welcome bonus amount** instead of resizing to the cheapest generation's exact cost. Rejected in favor of the tighter "one free taste" framing, which bounds the giveaway more predictably.
