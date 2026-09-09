# Tasks

## 1. Resolve open questions (done — see design.md's "Open Questions — resolved during apply")
- [x] 1.1 Welcome-bonus amount: **~~32~~ 10 credits** — corrected after pulling live `pricing_configs`/`billing_settings` from Supabase (see welcome-video-offer change): the real cheapest live video generation is Seedance 1 Pro Fast 480p/5s/no-audio at 2 credits/sec × 5s = 10, not the estimate this change originally used
- [x] 1.2 Showreel source: **extract from `HelloHero.tsx`** (named model-strip), not `AuthLayout.tsx` (unnamed background loop)
- [x] 1.3 Left placement is for **mobile stacking** — promo panel must be first in source/DOM order so it lands on top when collapsed
- [x] 1.4 Sanity-check done: **drop "Nano Banana 2"** from the modal's showreel (it's a Product Photo image model, not video) — use only **Kling v3** + **Seedance 2**

## 2. Admin: re-enable the welcome bonus
- [ ] 2.1 Via `/admin/pricing`, set `welcome_bonus_settings.enabled = true` and `credit_amount = 10` — **manual step for the user**, no DB credentials available in this environment to do it directly
- [ ] 2.2 Confirm a fresh regular-user signup actually receives the credits (check `credit_transactions` for `source = 'new_user_bonus'`, `type = 'bonus'`)

## 3. Auth modal — layout
- [x] 3.1 `AuthModalShell.tsx`: added optional `promoPanel` prop → two-column layout (`max-w-3xl`, `lg:flex-row`) when present; `ResetPasswordModal` (which never passes it) is untouched — still the original bare `max-w-md` single column
- [x] 3.2 `SignInModal.tsx` wires `promoPanel={<AuthPromoPanel mode={view} />}` — reuses the existing `view` state (`signin`/`signup`/`forgot-password`), no new mode-detection needed
- [x] 3.3 Responsive: promo panel is first in DOM order inside a `flex flex-col lg:flex-row` — top block on mobile, left column at `lg`+, no media-query branching needed (per decision 1.3/4)

## 4. Sign-up promo panel content
- [x] 4.1 Copy written — "Sign up and generate for free" + "New accounts get one free video generation — no typing needed, on us." — reworded from a raw "10 free credits" figure (a number nobody has context for yet) to describe the actual thing they get, matching the same wording change made across the popup/banner in `welcome-video-offer`
- [x] 4.2 Decided: **static copy for now**, documented in a code comment (reading live `welcome_bonus_settings` would need a new public/unauthenticated read endpoint — real new scope, not added silently). Follow-up: if the admin amount ever changes from 10, this copy needs a matching manual edit.
- [x] 4.3 **Revised after visual review**: sign-up no longer has its own separate gradient panel — it now shares the exact same video+marquee visual as sign-in (see 5.3), just with different title/subtitle text. The standalone gradient-panel treatment was the first pass; dropped once the user asked for one shared visual across both modes.

## 5. Sign-in promo panel content
- [x] 5.1 ~~Extract `HelloHero.tsx`'s model-strip~~ — **revised after visual review**: the model list and the video are now decoupled entirely. The video (`AUTH_MODAL_SHOWREEL`, still just the 2 real clips) loops on its own via `VideoBackdrop`'s built-in auto-advance (no more controlled `activeIndex` tying a pill click to a specific clip); the model list is a separate, continuously auto-scrolling marquee (`ModelMarquee`, reusing the exact `animate-marquee-left` pattern already proven in `HelloTestimonials.tsx`) showing the **full real video-model catalog** (`VIDEO_MODELS`, 19 entries) rather than a hand-picked 2-3. This also resolves the earlier Nano Banana 2 concern for free — the marquee no longer claims any specific pill "is" the clip currently playing, so there's no false pairing to avoid.
- [x] 5.2 Copy: "See what Kelolako can make" / "From script to a finished, captioned video — real output, real models." — no "new"/"latest" language
- [x] 5.3 **New, from visual review**: sign-up and sign-in now share one component (`PromoVisual` in `AuthPromoPanel.tsx` — video + marquee), parameterized by `title`/`subtitle` per mode via a `COPY` lookup, rather than two separate panel implementations.
- [x] 5.4 **New, from visual review**: modal height no longer jumps between sign-in/sign-up/forgot-password — `AuthModalShell`'s two-column row got a fixed `lg:min-h-[560px]`, with the form panel vertically centered inside it (`flex items-center`).

## 6. Polish (optional, not blocking)
- [ ] 6.1 Make the "already have an account? log in here" link on the sign-up duplicate-email error more prominent (design.md Decision 5 — confirmed safe mechanically, this is UX polish only) — **not done, left optional**

## 7. Verification
- [x] 7.1 `npx tsc --noEmit` (whole repo, zero errors) + `eslint` on every touched file (zero errors/warnings) — full `npm run build` blocked by the pre-existing, unrelated `@xyflow/react` canvas-feature gap (not installed locally), not by this change
- [ ] 7.2 Manual: open sign-up modal → promo panel shows free-credit copy; complete signup → confirm credits actually land in the account (**blocked on task 2.1** — bonus is still disabled until the admin toggle is flipped)
- [ ] 7.3 Manual: open sign-in modal → promo panel shows the model showcase, distinct from sign-up's panel
- [ ] 7.4 Manual: existing user mistakenly submits sign-up form with their email → inline duplicate error still works, no double grant (spot-check `credit_transactions`, should show only the original grant if any)
- [ ] 7.5 Manual: resize to mobile width → layout collapses sensibly (promo panel on top, form below)
- [ ] 7.6 Manual: confirm modal behavior is unchanged for the actual Google/email auth flows themselves (only chrome changed, not logic)
