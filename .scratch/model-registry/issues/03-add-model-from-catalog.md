# Let admins add a ready-made model from the catalog, and document how developers add new ones

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/427
Blocked by: 02

## Overview

Developers will be able to ship a new model hidden, and an admin then adds it from an "Add model" list in Admin Config once its price is set, so new models go live without a code release. Only models the app already knows how to run appear in that list, so a typo can never break creation. Users see the new model in their choices right after it is added.

## Implementation Requirements

1. **Ship-dark flag in code.** Add optional `offeredByDefault?: false` to the catalog entry types used by `defaultModelCatalogRows()` (`ProductPhotoTier`, `VideoModel`, `MotionControlModel`, or a small id → flag map in `lib/model-catalog-configs.ts`, whichever is the smaller diff). `defaultModelCatalogRows()` returns `enabled: false` for such entries; every existing entry keeps `enabled: true` (no behavior change). Both the materializer (`ensureModelCatalogRows`) and the runtime fallback (`codeDefaultEnabledIds`, `getEnabledCatalogModelIds` missing-row path) already read `enabled` from that function, so a shipped-dark model stays hidden whether or not its DB row exists.
2. **Add flow.** The registry (issue 01) lists models that are Not offered and not archived under "Add model". "Add" calls the guarded PATCH from issue 02 with `{ enabled: true, expectedUpdatedAt }` and audits as `model_add` when the model has never been offered (no prior `model_enable`/`model_add` audit row; if that cannot be determined, use `model_enable`). The dialog shows: model label, tool, the composers/features it will appear in (eligible ones whose `feature_model_configs` row is enabled or missing), price per pricing key (from `pricing_configs`), provider and whether it is configured, and the guard result. The confirm button is disabled with the reason when `PRICING_NOT_READY` or `PROVIDER_NOT_CONFIGURED`, with a link to the Pricing section.
   - No free-text model slug, provider or parameters input anywhere in this flow.
3. **Developer checklist** `docs/admin/adding-a-generation-model.md` (link it from `docs/admin/admin-config-v2-plan.md` and `docs/generation/fal-provider-runbook.md`): registry entry (id, labels, `modelRole`, `providerModel`, capabilities), provider adapter + input mapping + output normalizer + trusted output hosts (e.g. `lib/ai-providers/*`, `PROVIDER_CATALOG` in `lib/ai-provider-catalog.ts` for non-Replicate pairs), pricing keys + `V2_PRICING_DEFAULTS` + additive idempotent pricing migration with a fixed `credit_amount` (pattern: `supabase/migrations/026_seedance15_pro_pricing.sql`), `provider_model_costs` row for margin, composer/feature eligibility, history label (`lib/creation-model-label.ts` reads the registry), `offeredByDefault: false` to ship dark, then add from Admin Config. State that a model slug cannot be added from the UI and why.

## Technical Notes (verified in code)

- `defaultModelCatalogRows()` hardcodes `enabled: true` for every entry today.
- Composer/feature eligibility is code-only (`eligibleTiersForFeature`, `modelEligibleForComposer`); a missing `feature_model_configs` row means enabled, so a newly added model appears in every eligible composer unless an admin turns that composer off.
- `getProductPhotoTier`, `getVideoModel`, `getMotionControlModel` fall back to the default entry for an unknown id; registry entries must therefore never be removed casually (see issue 05).
- History labels come from code registries (`LABEL_BY_PROVIDER` in `lib/creation-model-label.ts`), with a humanized slug fallback.

## Acceptance Criteria

1. Self-check (REAL `defaultModelCatalogRows`, `getEnabledCatalogModelIds` missing-row path via an injected row list, and REAL guard): an entry with `offeredByDefault: false` is not offered with no DB row and with a materialized row; all current entries remain offered (snapshot of ids); adding it with pricing not ready is rejected; adding it with ready pricing passes and it then appears in the eligible composers' enabled list.
2. The Add dialog has no free-text slug/provider/parameter field; it is an accessible dialog (focus trap, Escape, labelled; reuse `components/ui/ConfirmDialog.tsx` if it fits), English copy, skeleton while the registry loads.
3. Audit row `model_add` (or `model_enable`) with before/after JSON.
4. The checklist doc exists and is linked. `npm run ci:checks` passes. No migration. No change for users until an admin adds a model.

## Comments
