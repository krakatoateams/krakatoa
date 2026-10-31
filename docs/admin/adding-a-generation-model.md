# Adding a generation model (developer checklist)

A model goes live in two steps: a developer ships it in code (hidden), then an admin turns it on in its
tool card in **Admin Config** once its price is set. No code release is needed for the second step.

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
   prices elsewhere. A new billing path (a new key a route bills through) must also extend
   `modelPricingKeys()`: `test:model-catalog-guard` asserts every route-billed key is covered, so an
   uncovered key fails CI instead of slipping past the "pricing ready" check.
4. **Margin data.** Add a `provider_model_costs` row (analytics only; the user price stays one
   `credit_amount` per key).
5. **Eligibility.** Composer/feature eligibility is code-only (`eligibleTiersForFeature` in
   `lib/creation-features.ts`, `modelEligibleForComposer` in `lib/video-composer-features.ts`). A
   missing `feature_model_configs` row means enabled, so an added model appears in every eligible
   composer unless an admin turns that composer off.
6. **History label.** `lib/creation-model-label.ts` reads the registry; set `modelLabel` and
   `providerModel` correctly.
7. **Choose `offeredByDefault` explicitly (ship dark by default).** Every new entry must set it:
   `false` (recommended) keeps the model hidden until an admin adds it in Admin Config after checking the
   price; `true` offers it on deploy. An entry without the flag is NOT offered, and
   `test:model-catalog-guard` fails until you choose. Only the models already offered before this rule
   (`OFFERED_BEFORE_SHIP_DARK` in `lib/model-catalog-configs.ts`, frozen: never add to it) may omit it.
   The flag only sets the shipped default: flipping it on a model that is already offered does not hide
   it, because its DB row stays enabled. Hide an existing model in its Admin Config tool card (switch it
Off, or Remove it).
8. **Self-checks.** Run `npm run test:model-catalog-guard` and the checks for the touched provider,
   then `npm run ci:checks`.

## After deploy

1. Apply migrations (`npm run db:setup`) so the pricing keys exist.
2. Open Admin Config and expand the tool card (Product Photo or Video). Each card has one model list:
   name, an On/Off switch and **Remove**; provider and features sit on a quiet second line, and pricing,
   modes and defaults open with the row's arrow. A ship-dark model is in the list switched Off.
3. Turn it On. The server guard refuses with one sentence next to the row while pricing is not ready
   (`PRICING_NOT_READY`) or the provider is not configured (`PROVIDER_NOT_CONFIGURED`).
4. The switch goes through the guarded `PATCH /api/admin/config/model-catalog/[id]` (guard,
   compare-and-set, audit). The first offer of a ship-dark model is audited as `model_add`; otherwise
   `model_enable`. Pricing and billing are never written by this flow.

## Removing a model, and adding it back

**Remove** (in the model's row) takes the model out of **that tool only**: it archives the tool's
`model_catalog_configs` row (migration 118, `POST …/[id]/archive`). It disappears from the card at once
and from users on their next request; past creations keep their label and prices are kept. The
confirmation names the features that lose it, the skills that use it and how often it was used. The server
refuses (and the dialog says why in one sentence) while the model is the default of a feature
(`IS_DEFAULT`: pick another default in the row's details first), the last model of the tool
(`LAST_ENABLED_MODEL`) or the last Reels engine (`REELS_ENGINE_LAST`). Catalog rows are per tool, so a
model is never shared between tool cards.

**Add model** (one button per card) lists only that tool's removed models. Choosing one restores it
(`POST …/[id]/restore`) and turns it on (`PATCH …/[id]`), re-running the price and provider guard; a model
that cannot be offered yet is listed with the reason and cannot be picked. The card updates without a
reload. Removing never edits the code registry; retiring a model from code is a separate developer task
(next section).

## Retiring a model

Full runbook: [`retiring-a-generation-model.md`](retiring-a-generation-model.md). The rules:

1. Archive it in Admin Config (**Remove**) first; change code only after no jobs are in flight and the
   72 h reconcile window has passed.
2. Never delete the registry entry or its sort-order id (set `offeredByDefault: false` instead), the archived
   `model_catalog_configs` row, its `feature_model_configs` rows or its pricing rows (deprecate them,
   pattern 040). A missing config row means "shipped default", so a deleted row could re-offer the model.
3. Never reuse a retired model id, provider slug or pricing key for a different model.
4. History keeps its labels (from the kept registry entry or the stored `modelLabel`) and its prices
   (`credit_transactions` and cost snapshots are never edited).
5. Verify: the model is gone from its tool card and listed under **Add model**, its row is archived, pricing rows are deprecated,
   an old creation still shows the right label, then `npm run ci:checks`.
The `model_add` vs `model_enable` audit label is derived from earlier audit rows, so a model enabled
before the audit table existed (117) is labelled `model_enable`; the label is informational only.

**When the model settings cannot be read (fail closed).** An archived or admin-disabled model must never
be usable. If reading `model_catalog_configs` / `feature_model_configs` fails (database error, timeout,
network), the app does NOT fall back to the code defaults: the model lists return a retryable 503 and show
"Models are temporarily unavailable. Please try again in a moment.", and every generate route (photo, video,
storyboard video, motion control, reels; Canvas nodes use photo/video) answers 503 before any credit spend or
provider call. There is no stale-state grace window. Only a table that does not exist at all (migration never
applied) uses the code defaults, so fresh environments and CI without a database keep working.
Check: `npm run test:model-catalog-guard`.
