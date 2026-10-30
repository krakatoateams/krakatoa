# Adding a generation model (developer checklist)

A model goes live in two steps: a developer ships it in code (hidden), then an admin adds it in
**Admin Config → Models → Add…** once its price is set. No code release is needed for the second step.

## Why a model slug cannot be added from the UI

A model only runs if code knows how to call it: provider adapter, input mapping, output normalizer,
trusted output hosts, pricing keys and a label. A free-text slug would create a model that is offered
but cannot run or be billed. The admin list is therefore built from the code catalog
(`defaultModelCatalogRows()`); only models that exist there can be added.

## Checklist

1. **Registry entry** in the right code registry: `PRODUCT_PHOTO_TIERS` (`lib/product-photo.ts`),
   `VIDEO_MODELS` (`lib/video-models.ts`) or `MOTION_CONTROL_MODELS` (`lib/motion-control-models.ts`):
   `id`, `label`, `modelLabel`, `modelRole`, `providerModel`, capabilities. Never remove an entry
   later: `getProductPhotoTier`, `getVideoModel` and `getMotionControlModel` fall back to the default
   model for an unknown id and history labels would be wrong.
2. **Provider wiring.** Replicate models: adapter, input mapping and output normalizer in the tool's
   pipeline. Non-Replicate pairs: `PROVIDER_CATALOG` in `lib/ai-provider-catalog.ts` and
   `lib/ai-providers/*`; output hosts must be on the trusted list (Fal: `*.fal.media`). See
   `docs/generation/fal-provider-runbook.md`.
3. **Pricing keys.** Keys come from `modelPricingKeys()` (`lib/model-pricing-keys.ts`). Add them to
   `V2_PRICING_DEFAULTS` and ship an additive, idempotent pricing migration with a fixed
   `credit_amount` (pattern: `supabase/migrations/026_seedance15_pro_pricing.sql`). Do not hardcode
   prices elsewhere.
4. **Margin data.** Add a `provider_model_costs` row (analytics only; the user price stays one
   `credit_amount` per key).
5. **Eligibility.** Composer/feature eligibility is code-only (`eligibleTiersForFeature` in
   `lib/creation-features.ts`, `modelEligibleForComposer` in `lib/video-composer-features.ts`). A
   missing `feature_model_configs` row means enabled, so an added model appears in every eligible
   composer unless an admin turns that composer off.
6. **History label.** `lib/creation-model-label.ts` reads the registry; set `modelLabel` and
   `providerModel` correctly.
7. **Ship dark.** Set `offeredByDefault: false` on the entry. `defaultModelCatalogRows()` then returns
   `enabled: false`, so the model stays hidden whether or not its DB row exists. Omit the flag and the
   model is offered on deploy (today's behavior for every existing model).
8. **Self-checks.** Run `npm run test:model-catalog-guard` and the checks for the touched provider,
   then `npm run ci:checks`.

## After deploy

1. Apply migrations (`npm run db:setup`) so the pricing keys exist.
2. Open Admin Config → Models, find the model under **Not offered**, press **Add…**.
3. The dialog shows the tool, where it will appear, price per key and the provider status. **Add model**
   is disabled with the reason while pricing is not ready (`PRICING_NOT_READY`) or the provider is not
   configured (`PROVIDER_NOT_CONFIGURED`).
4. Adding goes through the same guarded `PATCH /api/admin/config/model-catalog/[id]` as enable/disable
   (guard, compare-and-set, audit). The first offer of a ship-dark model is audited as `model_add`;
   otherwise `model_enable`. Pricing and billing are never written by this flow.
