# Clean up settings left behind by models developers retired, and document how to retire one

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/429
Blocked by: 04

## Overview

When developers fully retire a model from the app, a few leftover settings stay behind in Admin Config. This adds a careful "Delete permanently" for those leftovers only, with a preview first and a typed confirmation, and a short guide for developers on how to retire a model without breaking anyone's past creations. Users notice nothing; past creations and charges are never touched.

## Implementation Requirements

1. **Scope of hard delete = orphan config rows only.** An orphan is a `model_catalog_configs` row whose `(tool_key, model_id)` is not in `defaultModelCatalogRows()`, plus `feature_model_configs` rows whose `model_tier` is not eligible for any code composer/feature. Hard delete of a row for a model that still exists in code is forbidden (a missing row means "shipped default", which can silently re-offer the model).
2. **Never deleted by this feature:** `pricing_configs` rows (use `is_deprecated`), `provider_model_costs`, `model_configs`, jobs, assets, `generation_predictions`, `usage_events`, `credit_transactions`, user creations, audit log.
3. **Endpoints** (`withAdmin`, and owner-only: `ctx.admin.role === "owner"`, else 403; see open question 2 in spec.md):
   - `GET /api/admin/config/model-catalog/orphans`: lists orphans with a dry-run impact (same slug-based counts as issue 04's impact endpoint where a slug is known from the row's audit history or `metadata`; otherwise "unknown slug, history unaffected").
   - `DELETE /api/admin/config/model-catalog/orphans/[id]` `{ confirm: "<model_id>", expectedUpdatedAt }`: re-checks orphan status server-side at delete time, requires the typed `model_id` to match exactly, deletes the catalog row and that model's orphan `feature_model_configs` rows, writes one `model_purge` audit row with the deleted rows as `from_value` JSON (this JSON is the rollback path: re-insert). Idempotent: already gone → 200 no-op.
   - No DB function needed: deletes are by id with an orphan re-check in the same request; a concurrent re-introduction of the id in code cannot happen without a deploy.
4. **UI:** a collapsed "Leftover settings" section (hidden when empty) with Delete permanently → accessible dialog showing the dry run and a text field that must equal the model id; button disabled until it matches. English only.
5. **Developer runbook** `docs/admin/retiring-a-generation-model.md` (linked from `docs/admin/adding-a-generation-model.md` from issue 03): archive in Admin Config first; wait until no in-flight jobs and the 72 h reconcile window has passed for its jobs; keep the registry entry's label available for history (move it to a retired-label map consumed by `lib/creation-model-label.ts` rather than deleting it, because `getProductPhotoTier` / `getVideoModel` / `getMotionControlModel` fall back to the default for unknown ids); remove it from composer eligibility and code defaults/FALLBACKS; deprecate pricing rows with an additive migration (pattern 040); then purge orphans here. Precedent: 040/041 Kling 2.0, 113 GPT Image 2.

## Technical Notes (verified in code)

- `admin_users.role` is `owner | admin` (007); `CurrentAdmin.admin` carries it.
- Runtime readers iterate code defaults and ignore DB rows for unknown ids (`getEnabledCatalogModelIds`, `getPhotoFeatureEnablement`, `getVideoComposerEnablement`), so orphans are harmless at runtime; this issue is housekeeping and can be skipped if the user prefers (open question 3).
- `ensureFeatureModelRows` / `ensureModelCatalogRows` only insert missing rows; they never delete.

## Acceptance Criteria

1. Self-check with the REAL `defaultModelCatalogRows` and eligibility functions: a row for an id in code is never classified orphan; a row for an unknown id is; delete with a wrong confirm string → 400; delete of a non-orphan → 409 `NOT_ORPHAN`; non-owner admin → 403; repeat delete → 200 no-op; exactly one audit row containing the deleted rows.
2. Nothing outside `model_catalog_configs` / `feature_model_configs` is deleted (asserted by test against the query builder calls).
3. Runbook exists and is linked. `npm run ci:checks` passes. English-only copy. Works whether or not migration 118 is applied (orphan purge does not depend on `archived_at`).

## Comments
