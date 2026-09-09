# Tasks

## 1. Skill catalog
- [x] 1.1 `lib/skills.ts`: add `Skill.resolution?: VideoResolution` (type-only import from `lib/video-models`)
- [x] 1.2 Add `"welcome-video"` to `SKILL_IDS`, export `WELCOME_VIDEO_SKILL_ID`
- [x] 1.3 New `SKILLS` entry: `promptRequired: false`, `modelId: "seedance1_pro_fast"`, `resolution: "480p"`, `inputs: []`
- [x] 1.4 New `SKILL_RECIPE_DEFAULTS["welcome-video"]` — fixed scene description, no `{prompt}` token
- [ ] 1.5 Real thumbnail asset at `public/skills/welcome-video.jpg` — **needs a design asset**, not code; tile shows a broken image until this lands

## 2. Composer
- [x] 2.1 `SkillComposer.tsx`: snap `videoResolution` to `skill.resolution` when pinned and valid (new effect next to the existing `modelId`-designation one)

## 3. Eligibility + offer surface
- [x] 3.1 `lib/jobs-db.ts`: `hasAnyJobs(profileId)` — count-only query
- [x] 3.2 `GET /api/welcome-video-offer` — welcome bonus enabled AND zero jobs ever
- [x] 3.3 `components/WelcomeVideoOfferCard.tsx` — dismissible inline card, session-scoped dismiss key, CTA → `skillHref(WELCOME_VIDEO_SKILL_ID)`
- [x] 3.4 Wire into `app/(app)/dashboard/page.tsx` above the embedded `SkillComposer`

## 4. Welcome-bonus amount correction (shared with auth-modal-promo-panels)
- [x] 4.1 Live `pricing_configs`/`billing_settings` pulled from Supabase — confirmed cheapest real config is Seedance 1 Pro Fast 480p/5s/no-audio = 10 credits, not the original 32-credit estimate
- [x] 4.2 `AuthPromoPanel.tsx` copy corrected to "10 free credits"
- [x] 4.3 `auth-modal-promo-panels/tasks.md` + `design.md` corrected in place with a note on the correction

## 5. Verification
- [x] 5.1 `npx tsc --noEmit` + `eslint` on every touched file
- [ ] 5.2 `npm run dev` manual click-through: sign up a fresh test account (or use one with zero jobs) → land on `/dashboard` → card shows the real welcome-bonus amount → click Claim → composer switches to the welcome-video skill with Generate already enabled, no typing needed → Generate succeeds and spends the expected credits
- [ ] 5.3 Confirm the card does NOT show for an account that already has at least one job
- [ ] 5.4 Confirm the card does NOT show when `welcome_bonus_settings.enabled = false` (current default until `auth-modal-promo-panels` task 2.1 is done)
- [ ] 5.5 Confirm dismiss (X) hides the card for the rest of the session without generating anything

## 6. Revised after first round of manual testing (2026-09-09)
Real bugs found by clicking through: the eligibility check used wallet balance
(correct for auto-grant, backwards for claim-on-demand — balance is
deliberately 0 before claiming), and the dismiss key wasn't scoped per
account (stuck "dismissed" across a delete+re-register test in the same
browser tab). Both fixed. Also pivoted the offer surface per user feedback:
a global popup (fires from any entry point, not just /dashboard) plus the
existing card as a fallback for whoever closes the popup without claiming.

- [x] 6.1 **Migration `089_welcome_bonus_on_claim.sql`**: removed the regular-user auto-grant branch from `krakatoa_seed_initial_credits()` — new accounts now start at 0 credits (admin's 500 dummy-credit seed unchanged). Welcome bonus is granted on-demand instead — **user needs to run this migration manually** (same no-DB-credentials pattern as before)
- [x] 6.2 `lib/credits-db.ts`: `hasCreditTransaction(profileId, idempotencyKey)` — read-only check, no mutation
- [x] 6.3 `lib/welcome-video-offer.ts`: shared eligibility rule (`enabled && !hasAnyJobs && !hasClaimed`, checked via the claim's own idempotency key — NOT wallet balance) + `welcomeVideoClaimIdempotencyKey()`, used by both routes below
- [x] 6.4 `GET /api/welcome-video-offer` rewritten onto the shared helper (old wallet-balance check removed — was backwards under the new model)
- [x] 6.5 `POST /api/welcome-video-offer/claim` (new) — re-validates eligibility server-side, grants credits via `addBonusCredits` with the claim idempotency key (safe to retry, never double-grants), returns the composer href
- [x] 6.6 `lib/use-welcome-video-offer.ts` (new hook) — shared eligibility-fetch + claim + per-user dismiss-key logic between the card and the new modal, so the two surfaces stay in sync without duplicating the fetch/claim calls
- [x] 6.7 `WelcomeVideoOfferCard.tsx` — Claim now actually calls the claim endpoint (grants credits) before navigating, instead of just navigating on stale/ungranted credits
- [x] 6.8 `components/WelcomeVideoOfferModal.tsx` (new) — global "Welcome, {name}! now you can try generate for free" popup, shown once per session per account, mounted in `app/(app)/layout.tsx` (app-shell level, fires from any tool, not just /dashboard). Independent dismiss state from the card on purpose — closing the popup must not hide the fallback card
- [x] 6.9 Renamed the skill from "Your first video" → **"Golden Hour Coffee"** (describes what it actually generates) with no "free"/"welcome" language on the skill itself, since any user can pick it from the normal Skills catalog regardless of offer eligibility
- [ ] 6.10 Manual re-test: fresh signup → balance is 0 until Claim is clicked (in either the popup or the card) → balance becomes 10 only after Claim → composer generates successfully
- [ ] 6.11 Manual: sign up while on Schedule (a non-dashboard entry point) → popup fires there → close it without claiming → navigate to Dashboard's Skills composer → fallback card is still there
- [ ] 6.12 Manual: delete + re-register the same email in the same browser tab → popup/card correctly re-evaluate for the new account instead of staying dismissed from the old one
