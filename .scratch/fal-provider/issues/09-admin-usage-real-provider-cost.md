# Show the real provider cost in the admin usage margin

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/420
Blocked by: none

## Overview

The admin Usage page shows an estimated cost for each AI model, but today that number is just the credits users spent converted to money, so it never reflects what each AI provider really charges. After this change the page uses the real per-model cost the team already keeps up to date, so margins show what we actually pay, and it says which kind of number it is showing. What users pay does not change.

## Implementation Requirements

- In `getAdminUsage` (`lib/admin-metrics-db.ts`), compute the cost of each usage event from `provider_model_costs` (`cost_usd` × `units`) matched on `usage_events.provider` + `usage_events.model` + `metadata->>'pricingKey'`.
- When no cost row matches (missing provider/model/pricingKey, non-photo tools, dev_blank, unknown pair), fall back per event to the current estimate (credits × `credit_value_idr` ÷ `usd_to_idr`). Never throw or drop an event for a missing row; tolerate a missing/empty `provider_model_costs` table read (treat as no rows).
- Extend `UsageAggregate` with a cost source label: `provider_cost`, `estimated` or `mixed` (aggregate has both), plus the number of events covered by real cost. Keep `estimatedCostUsd`/`estimatedCostIdr` semantics (IDR = USD × `usd_to_idr`) so existing consumers keep working.
- Show the source in the admin Usage UI next to the cost (small English label such as "Provider cost", "Estimate", "Mixed"; English only) and update the column help text.
- Aggregation key must also split by pricingKey only if needed to price correctly; keep the visible rows grouped by tool/provider/model.
- Read `provider_model_costs` once per request via `listProviderModelCosts()` (`lib/provider-model-costs-db.ts`), build a Map keyed `provider||model||pricing_key`.

## Technical Notes (verified in code)

- `getAdminUsage` currently ignores `provider_model_costs`; `estimatedCostUsd = credits × creditValueIdr ÷ usdToIdr` per (tool, provider, model). The `usage_events.estimated_cost_usd` column is never populated.
- `pricingKey` is NOT a column on `usage_events`: it is written into `usage_events.metadata.pricingKey` by `app/api/generate-photo/route.ts` (the `recordUsageEvent` call near the end of the route). `provider` and `model` are columns (`photoModel.provider`, `photoModel.model`; `dev_blank` for dev runs). Other tools may not set `pricingKey`.
- `provider_model_costs` (migration 114; seeded for replicate in 114, fal in 115/116) has PK (provider, model, pricing_key), `cost_usd >= 0`, `cost_unit` (`per_image`). Today it only feeds the config-v2 admin UI (`app/(app)/admin/config-v2/page.tsx`).
- `units` for photo events = successful images, so `cost_usd × units` is the per-image provider cost. Event rows are capped by `ROW_CAP`; keep that.
- Verified live: the Fal Nano Banana bill matched the 0.0398 seed.

## Acceptance Criteria

- A Fal Nano Banana event (provider `fal`, model, pricingKey with a seeded row, units 2) contributes `cost_usd × 2`, not the credits-based estimate.
- An event with no matching row, no pricingKey, null provider/model, or `dev_blank` falls back to the old estimate; a mixed aggregate is labelled `mixed`; the page renders when `provider_model_costs` is empty or unreadable.
- Admin editing a cost in config-v2 changes the Usage numbers on next load.
- Credit prices users pay, `credit_amount`, spend/refund and all billing code are untouched (analytics only; no migration).
- A focused self-check (pure aggregation function with fake rows) covers: match, fallback, mixed, missing table, units multiplication; wired into `package.json` and `npm run ci:checks`. Lint and build pass.

## Comments
