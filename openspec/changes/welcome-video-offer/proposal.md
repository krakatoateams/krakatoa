# Welcome Video Offer

## What

Give brand-new, never-generated accounts a genuine one-click free video: a
dismissible card on `/dashboard` ("Claim your free video") that jumps into a
pinned, zero-typing generation — the person just clicks Generate.

## Why

Follow-up to `auth-modal-promo-panels`, which redesigned the auth modal to
promise "register now and generate for free" but explicitly scoped out the
actual redirect-to-generation flow (no new-user detection existed, and the
flagship Reels Creator tool is admin-gated). This change closes that gap
using infrastructure that already exists — the Skills system — instead of
building a parallel one.

A teammate raised a real constraint mid-design: the demo generation's prompt
should not be visible/copyable by the user (so it can't just be lifted and
run somewhere else). Skills already solve this today for every existing
skill — the actual model instructions (`recipe`) are assembled into the
final prompt server-side, inside the generate route, and never shipped to
the browser. This change reuses that same guarantee rather than inventing a
new one.

## Scope

- One new Skill (`welcome-video`, `promptRequired: false`, fixed recipe, no
  `{prompt}` token) pinned to the cheapest live video config — Seedance 1 Pro
  Fast, 480p, 5s, no audio, confirmed via live `pricing_configs` at 2
  credits/sec × 5s = **10 credits**. Matches the welcome-bonus grant amount
  (`auth-modal-promo-panels` task 1.1, corrected from 32 → 10 in the same
  pass — see that change's design.md).
- Small `Skill.resolution` pin (new optional field) + one `SkillComposer.tsx`
  effect, since every catalog model's own default resolution is 720p/1080p —
  pinning `modelId` alone can't reach the advertised 480p/10-credit cost.
- `GET /api/welcome-video-offer` — eligibility check: welcome bonus actually
  enabled (admin toggle) AND this profile has zero jobs ever
  (`hasAnyJobs` in `lib/jobs-db.ts`). Checked server-side against real job
  history, not a client flag, so it's correct regardless of whether the
  visitor signed up via Google (same-tab) or email confirmation (frequently
  a different tab/device — a sessionStorage "just signed up" flag would not
  survive that).
- `WelcomeVideoOfferCard` — dismissible inline card on `/dashboard`, not an
  auto-opening modal. Deliberately doesn't touch the existing post-auth
  `next` redirect (which intentionally returns a visitor to whatever page
  they were on before signing in/up) — the offer is an invite sitting on the
  page they land on by default, not a hijack of where they were headed.

## Out of scope

- Changing `next` resolution / auth redirect behavior.
- A real thumbnail image asset for the new skill tile
  (`public/skills/welcome-video.jpg`) — needs a design asset, flagged in
  tasks.md.
- Admin UI for configuring which skill/model backs this offer — hardcoded to
  `welcome-video` for now, same pattern as the credit-pack promo
  (`lib/promo-offer.ts`'s `PROMO_TIERS`).
