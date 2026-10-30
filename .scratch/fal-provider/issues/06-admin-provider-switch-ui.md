# Let admins choose Replicate or fal.ai per photo model

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/398
Blocked by: 05

## Overview

Admins get a simple choice in the Admin panel to run each of the four photo models on either the current provider or the new one. Each choice changes the model and its settings together, and it shows the team's real cost and margin for the provider in use, while users keep paying the same price.

## Implementation Requirements

- Admin Config UI: per photo tier (basic, balanced, pro, gpt_image_2) a provider dropdown listing ONLY providers that have a catalog entry for that tier; all other models stay "Replicate only". Provider + model + parameters switch as one unit chosen from the catalog (no raw params JSON).
- Admin API: validate against the catalog; reject a switch when `credit_amount` is null (phase 3). Write an audit-trail entry for every provider switch (who, tier, from → to).
- Pricing view: margin and cost follow the active provider (cost from the phase 3 table); the user credit price remains one value per feature.
- Reset to default (`app/api/admin/config/models/[id]/reset`) resets provider, model and parameters together to Replicate. Keep the three aligned default definitions in sync: SQL seed, `lib/model-resolver.ts` FALLBACKS + `lib/credit-costs.ts`, `lib/admin-config-defaults.ts`.
- `usage_events.provider` must be set from the resolved provider (today callers use `photoModel.provider` in `generate-photo`, but check every usage/analytics route under `app/api/admin/{summary,analytics,usage}` for Replicate assumptions). Admin monitoring shows the provider per generation.
- Switch latency is the resolver's 60 s cache; show that note in the UI.
- English UI copy only; dark-first, restrained motion, shape-matched skeletons for loading.

## Technical Notes (verified in repo)

- `model_configs.provider` exists; admin model route is `app/api/admin/config/models/[id]/route.ts`; validation in `lib/admin-config-validation.ts`; defaults in `lib/admin-config-defaults.ts` (`MODEL_DEFAULTS`, pricing defaults).
- `lib/pricing-math.ts` treats `provider_cost_usd` as billing fallback only when `credit_amount` is null.

## Acceptance Criteria

- Admin can flip each of the 4 tiers to Fal and back; generation uses the chosen provider within the cache TTL; users' credit cost is unchanged; audit entry written; reset restores Replicate.
- Tiers without a Fal catalog entry show no Fal option.
- `npm run ci:checks`, `test:admin-config-*`, lint and build pass. Default stays Replicate for fresh and reset configs; rollback = switch back or reset.

## Comments
