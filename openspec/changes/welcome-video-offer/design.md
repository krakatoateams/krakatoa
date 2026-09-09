# Design — Welcome Video Offer

## Why reuse Skills instead of a new hidden-prompt endpoint

The first idea discussed was a dedicated API route that accepts no prompt at
all and injects one server-side. Investigating `app/api/generate-video/route.ts`
found this already exists in a more general form: any Skill's `recipe` is
assembled into `providerPrompt` inside the route (`assembleSkillPrompt`,
line ~518) and is never part of the request/response the browser sees.
`promptRequired` is enforced only client-side
(`SkillComposer.tsx`: `canGenerateVideo = ... && (!skill.promptRequired || prompt.trim().length > 0)`),
and the API itself never requires a non-empty prompt. So a skill with
`promptRequired: false` and a recipe with no `{prompt}` token already is a
one-click, hidden-prompt generation — no new route, no new spend/refund
path, full reuse of the existing credit ledger contract.

This also means the new skill's prompt gets exactly the same protection
every other skill's recipe already has (e.g. "high-quality-film"'s cinematic
styling wrapper) — not a weaker or novel guarantee.

## Why a `resolution` pin was necessary

Checked every catalog entry in `lib/video-models.ts`: every model's
`defaultResolution` is `"720p"` or `"1080p"` — none default to 480p. Pinning
only `modelId` (the existing mechanism) would land on a more expensive
default combo than the advertised 10 credits. Added `Skill.resolution?:
VideoResolution` (mirrors the existing `modelId?: string` "admin-pinned,
absent = catalog default" pattern) and one effect in `SkillComposer.tsx`
that snaps `videoResolution` to the pin when valid, alongside the existing
`modelId`-designation effect it sits next to.

## Why an inline card, not a redirect or a modal

Traced how new users actually reach the app post-signup
(`SignUpForm.tsx`, `AuthModalProvider.tsx`):

- Google sign-up completes in-page immediately.
- Email/password sign-up requires clicking a confirmation link — often a
  different browser tab, sometimes a different device. Any flag set at
  submit-time (e.g. `sessionStorage`) is not guaranteed to exist by the time
  the user is actually authenticated and back in the app.
- `AuthModalProvider`'s `next` defaults to **the page the visitor was
  already on** when the modal opened (`openModal`'s comment: "so a gated
  action always resumes where it was triggered"). Overriding this default
  for signups would break that contract for anyone who signed up mid-task
  elsewhere in the app — and today literally every call site uses
  `openSignInModal()` (never `openSignUpModal()`), reaching "signup" only by
  switching the modal's internal view, so there is no isolated "plain
  signup" entry point to special-case anyway.

Given that, the reliable, path-agnostic signal is server-side: "does this
profile have zero jobs, ever" (`hasAnyJobs`), checked when `/dashboard`
loads — which is where both signup paths land by default absent an explicit
`next`. This mirrors the existing `PromoOfferModal` / `/api/promo-offer`
pattern already on that page (code+DB gate, session-scoped dismiss key) but
as a non-blocking inline card rather than an auto-opening modal, since this
offer isn't time-sensitive the way the promo is and shouldn't compete with a
possible in-flight `next` redirect for attention.

## Why job-count, not account-age

`hasAnyJobs(profileId)` (new, `lib/jobs-db.ts`) checks whether the profile
has ever created a single job — not `profiles.created_at` recency. This is
strictly more correct for "never generated anything, doesn't know what
Kelolako can do" and self-corrects with no time window to tune: the moment
they generate once (through this offer or anywhere else), the card stops
showing, permanently, with no expiry logic needed.

## Eligibility also requires the welcome bonus to be enabled

`GET /api/welcome-video-offer` checks `getWelcomeBonusSettings().enabled` in
addition to `!hasAnyJobs`. Advertising "10 free credits" to someone whose
account was never actually granted any would be a real, visible bug, not
just copy drift — the admin toggle in `auth-modal-promo-panels` task 2.1 is
a hard dependency of this offer actually being honest.
