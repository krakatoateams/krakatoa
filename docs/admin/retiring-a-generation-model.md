# Retiring a generation model (developer runbook)

Use this when a catalog model (photo tier, video model, motion control model) should stop being offered
for good. Retiring never touches users' past creations, jobs or charges. The short version:

- **Archive first** (Admin Config → the model's tool card → **Remove**). Do code changes after.
- **Never delete** the registry entry, the `model_catalog_configs` row, the `feature_model_configs` rows
  or the pricing rows.
- **Never reuse** a retired model id, provider slug or pricing key for a different model.

There is no "Delete permanently" button, on purpose (issue #429). Leftover rows for a retired model are
ignored by the runtime, and keeping them is the safer state (see "Why rows are never deleted").

## Steps

1. **Archive it in Admin Config.** Expand the model's tool card and press **Remove** in its row
   (migration 118). The confirmation shows the features that lose it, the Reels engine it runs, the skills
   that use it, jobs still running and how many creations used it. The server guard (`checkModelCatalogChange()`) refuses while the model is
   the default of a composer (`IS_DEFAULT`: pick another default first), the last offered model of a
   tool (`LAST_ENABLED_MODEL`), or the model behind the last offered Reels engine (`REELS_ENGINE_LAST`).
   Archiving sets `archived_at` and `enabled = false`; the catalog read has no cache, so users stop seeing
   it on the next request and generate routes reject it.
   **Add model** in the same card brings it back (restore, then turn on) at any time while the entry
   stays in code; after step 5 it is listed there as "Needs a price before it can be added"
   (`PRICING_NOT_READY`) until a price exists again.
2. **Wait.** No in-flight jobs on the model (the impact preview's count is 0), and at least 72 h since
   its last job, so reconcile has settled every held Fal job and per-image row
   (`docs/generation/fal-provider-runbook.md`).
3. **Keep the registry entry.** Leave it in `PRODUCT_PHOTO_TIERS` (`lib/product-photo.ts`),
   `VIDEO_MODEL_REGISTRY` + `VIDEO_MODEL_SORT_ORDER` (`lib/video-models.ts`) or
   `MOTION_CONTROL_MODEL_REGISTRY` + `MOTION_CONTROL_SORT_ORDER` (`lib/motion-control-models.ts`), and
   add `offeredByDefault: false`. The id must stay in the sort order too: `VIDEO_MODELS` /
   `MOTION_CONTROL_MODELS` are built from it, and both the catalog and the history labels read them.
   History labels (`lib/creation-model-label.ts`) map the recorded provider slug and `modelTier` through
   the registry; without the entry an old creation shows a made-up name from the slug
   (`humanizeProviderSlug`) or a generic tool label. Other callers of `getProductPhotoTier` /
   `getVideoModel` / `getMotionControlModel` silently fall back to the DEFAULT model for an unknown id.
   If an entry ever has to leave the registry, first add a retired-label map read by
   `lib/creation-model-label.ts` (none exists today).
4. **Remove it from code defaults and eligibility.** It must not be anyone's default:
   `defaultTierForFeature` (`lib/creation-features.ts`), `defaultModelForComposer`
   (`lib/video-composer-features.ts`), `FALLBACKS` (`lib/model-resolver.ts`, only if it names the
   model's provider slug), and any skill that sets `modelId` to it in `lib/skills.ts`. Then drop it from
   composer eligibility (`eligibleTiersForFeature`, `modelEligibleForComposer`). Do NOT remove its
   name from `TOOL_MODEL_FALLBACK` in `lib/creation-model-label.ts`: that map only labels old
   creations.
5. **Deprecate its pricing rows** with an additive, idempotent migration:
   `update pricing_configs set is_deprecated = true, enabled = false where pricing_key = '…'` (pattern:
   `040_deprecate_kling20.sql`). Keep the rows. `041_delete_kling20.sql` deleted rows only because Kling 2.0
   never ran in production; do not copy it for a model with history. A provider slug swap inside
   `model_configs` follows `113_retire_gpt_image_2_model_config.sql` (update, never delete).
6. **Leave the config rows.** The `model_catalog_configs` row stays archived and the
   `feature_model_configs` rows stay in place. Never delete them (next section).
7. **Never reuse the id.** A retired model id, provider slug (`providerModel`) or pricing key is never
   given to a different model. A new model gets a new id, slug entry and pricing key
   (`docs/admin/adding-a-generation-model.md`).

## Why rows are never deleted

- A missing `model_catalog_configs` or `feature_model_configs` row means "use the shipped default".
  If a deleted id ever came back in code, the model would be offered without an admin choosing to.
  The archived row keeps it hidden.
- Runtime readers iterate the code catalog and ignore DB rows for unknown ids
  (`getEnabledCatalogModelIds`, `getPhotoFeatureEnablement`, `getVideoComposerEnablement`), and
  `ensureModelCatalogRows` / `ensureFeatureModelRows` only insert missing rows. So leftovers do nothing,
  and deleting them helps no user.
- Also never deleted by a retirement: `pricing_configs` (use `is_deprecated`), `provider_model_costs`,
  `model_configs`, jobs, assets, `generation_predictions`, `usage_events`, `credit_transactions`, user
  creations and the admin audit log.
- If a purge is ever truly needed, a developer does it as a reviewed, idempotent migration, never from
  the UI.

## What stays the same for users

- **Labels.** Past creations keep their model name: the label comes from the asset's recorded
  provider slug or `modelTier` through the kept registry entry, or from the `modelLabel` stored on
  the creation.
- **Prices.** Past charges live in `credit_transactions` and are never edited. Job and asset cost
  snapshots stay as they were. The deprecated pricing rows keep the key readable for admin reports.
- **Skills** that designated the model fall back to the live default model; the skill itself is never
  deleted.

## Verify

1. Admin Config: the model is gone from its tool card and appears under that card's **Add model**.
2. SQL: `select enabled, archived_at from model_catalog_configs where model_id = '<id>';` returns
   `false` and a timestamp. `select is_deprecated, enabled from pricing_configs where pricing_key in
   ('<key>', …);` returns `true, false`.
3. The composer for that tool no longer lists it, and generating with its id is rejected.
4. Open an old creation made with it in the library: the model label is unchanged.
5. Code: no default function (`defaultTierForFeature`, `defaultModelForComposer`) or eligibility
   function returns the id, and no skill in `lib/skills.ts` sets `modelId` to it. The id still appears
   in the registry, sort order, id types and pricing defaults; that is expected.
6. `npm run test:model-catalog-guard`, then `npm run ci:checks`.

Precedents: 040/041 (Kling 2.0), 113 (GPT Image 2 → GPT Image 2.5 Flare).
