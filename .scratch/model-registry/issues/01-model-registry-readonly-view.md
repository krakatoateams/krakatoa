# Show every generation model's status in Admin Config (read-only) and add the shared safety rules

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/425
Blocked by: none

## Overview

Admins will see one clear list of every photo and video model the app can run, with a plain label for each: offered to users, not offered, or not ready yet and why (for example, no price set). Nothing can be changed from this list yet, so users notice nothing. It lays the groundwork for safely adding and removing models in the next steps.

## Design note

The full design (decisions, rejected alternatives, data model, invariants, failure modes, test plan, open questions) is in `.scratch/model-registry/spec.md`. Summary:

- "Add" = offer a model that already exists in the code catalog; adding a brand-new model slug stays a developer task (adapter, parameter mapping, output normalizer, trusted output hosts and pricing keys live in code).
- "Remove" = soft archive (hidden from users, history and pricing kept, reversible). Hard delete only for DB rows of models that no longer exist in code.
- Source of truth for what EXISTS: `defaultModelCatalogRows()` (`lib/model-catalog-configs.ts`), which already merges `PRODUCT_PHOTO_TIERS`, `VIDEO_MODELS`, `MOTION_CONTROL_MODELS`; Reels Creator engines map onto it via `REELS_ENGINE_CATALOG_MODEL_ID`. Source of truth for what is OFFERED: `model_catalog_configs` (migration 048). No new registry, no new table.
- All guardrails are server-side in one pure function, `checkModelCatalogChange()`, built in this issue and wired into writes in issue 02.
- Open questions (defaults chosen, nothing blocked): see spec.md. Main ones: block re-enabling a model priced only by the built-in default (default: yes); owner-only hard delete (default: yes); two-step "pick another default, then disable" (default: yes).

## Implementation Requirements

1. **Pure guard core** in a new `lib/model-catalog-guard.ts` (no I/O):
   - `modelPricingKeys(toolKey, modelId): string[]`: every pricing key the model bills through. Reuse the enumeration the admin tree already does (`enumeratePhotoVariants` and the video/motion variant builders in `lib/admin-config-tree.ts`, which call `productPhotoPricingKey`, `VideoModel.pricingKey(ctx)`, `MotionControlModel.pricingKey(mode)`). Extract a shared helper if needed; do not duplicate the key lists.
   - `checkModelCatalogChange(input): { ok: true; warnings: string[] } | { ok: false; code: string; reasons: string[] }` where `input` holds the target `(toolKey, modelId)`, the requested change (`enable` | `disable`; issue 04 adds `archive` | `restore`), the current `model_catalog_configs` rows, `feature_model_configs` rows, `pricing_configs` rows (`pricing_key, enabled, is_deprecated, credit_amount`), and the active provider + `isProviderConfigured` result. Rules (spec.md "Invariants" 1–5):
     - unknown `(toolKey, modelId)` (not in `defaultModelCatalogRows()`) → `UNKNOWN_MODEL`;
     - disable leaves a tool family with zero offered models, or a currently usable composer/feature (`eligibleTiersForFeature`, `eligibleModelsForComposer`) with zero enabled models → `LAST_ENABLED_MODEL`;
     - disable of the effective default of any composer/feature (DB `is_default`, else `defaultTierForFeature` / `defaultModelForComposer` as resolved by `getPhotoFeatureEnablement` / `getVideoComposerEnablement` logic) → `IS_DEFAULT` with the composer names;
     - disable of a `REELS_ENGINE_CATALOG_MODEL_ID` model when no other Reels Creator engine stays offered → `REELS_ENGINE_LAST`;
     - enable when any `modelPricingKeys` key has no row, a disabled row, a deprecated row, or a non-integer/negative `credit_amount` → `PRICING_NOT_READY` listing the keys;
     - enable when the active provider is not configured → `PROVIDER_NOT_CONFIGURED`;
     - same target state → ok with `noop`.
   - To keep the rules identical to runtime, factor the enabled/default computation out of `getPhotoFeatureEnablement` / `getVideoComposerEnablement` (`lib/feature-model-configs-db.ts`) into pure functions that both the runtime readers and the guard call. Runtime output must stay byte-for-byte the same.
2. **Read-only registry endpoint** `GET /api/admin/config/model-registry` (`withAdmin`): returns, per tool and per catalog model: `modelId`, label, tool, `catalogConfigId`, `enabled`, `updatedAt`, composers/features where enabled and where default, `isCodeDefault`, `reelsEngine`, `pricingKeys` with readiness, provider + configured, and the would-be result of `checkModelCatalogChange` for enable and disable (so the UI can explain why an action is unavailable). Reuse `ensureModelCatalogRows()`, `ensureFeatureModelRows()`, `listPricingConfigs()`; no new DB reads beyond those. Do not mint signed URLs or read secrets.
3. **UI** in `app/(app)/admin/config-v2/page.tsx`: a read-only "Models" status section (or badges on the existing model cards, whichever matches the page) showing state (Offered / Not offered), "Default for …", "Pricing not ready: …", "Provider not configured", "Used by Reels Creator engine". Shape-matched skeleton while loading; clear empty and error states; premium dark-first, English-only copy. The existing on/off toggle keeps working exactly as today in this issue.

## Technical Notes (verified in code)

- `model_catalog_configs` (048): `unique (tool_key, model_id)`, `updated_at` trigger, RLS deny-all; missing row = shipped default. Rows are materialized on admin GET by `ensureModelCatalogRows()`. Tool keys today: `photo`, `reels` (`ModelCatalogToolKey`).
- Runtime enforcement is at request start only: `app/api/generate-photo/route.ts` (~line 421, also the skill-designated tier ~line 465), `generate-video` (~371), `generate-motion-control` (~205), `generate-storyboard-video` (~203), `generate-reels` (~206, via `REELS_ENGINE_CATALOG_MODEL_ID`); studio lists via `app/api/tools/photo/features` and `app/api/tools/video/features`.
- Enablement caches use `CACHE_TTL_MS = 0` in `lib/feature-model-configs-db.ts` and `lib/model-catalog-configs-db.ts` (a DB read per call; changes apply on the next request). `lib/model-resolver.ts` (provider binding, not catalog) has a 60 s per-instance cache; this feature does not change provider binding.
- Today, disabling every model of a feature is possible: the readers then return `enabledTiers: []` and every generation for that feature is rejected with 400. That is why `LAST_ENABLED_MODEL` exists.
- `pricing_configs.credit_amount` is `int not null` (007). A missing, disabled or deprecated row makes `lib/pricing-resolver.ts` fall back to the built-in provider-cost default (`V2_PRICING_DEFAULTS`).
- `isProviderConfigured` (`lib/ai-provider-catalog.ts`) only checks `FAL_KEY` for `fal`; active photo provider comes from `activePhotoProvider` (`lib/admin-provider-switch.ts`).
- UNVERIFIED: whether any non-photo/reels tool should join the catalog later. Out of scope.

## Acceptance Criteria

1. `lib/model-catalog-guard-self-check.ts` exists, runs with `npm run test:model-catalog-guard`, and is added to `npm run ci:checks`. It uses the REAL `defaultModelCatalogRows`, eligibility, default and pricing-key functions (no mocks of the logic; only DB rows are in-memory fixtures) and asserts at least: unknown model rejected; disabling the last enabled model of a feature/composer rejected; disabling an effective default (DB flag and code default) rejected with the composer names; disabling `seedance2_fast` while it is the only offered Reels engine rejected; enabling with a missing, disabled, deprecated pricing row rejected with the key list; enabling a Fal-bound photo tier without `FAL_KEY` rejected; same-state change is a no-op; a normal disable/enable passes.
2. A self-check proves the refactored pure enablement functions return the same result as before for: no rows, all disabled, DB default set, DB default disabled.
3. `GET /api/admin/config/model-registry` returns 401 without a session and 403 for a non-admin; the payload contains no secrets.
4. The Config v2 page shows the read-only status with skeleton loading; no write behavior changes; existing admin config self-checks, `npm run lint`, `npm run typecheck`, `npm run build` pass. English-only copy. No migration.

## Comments
