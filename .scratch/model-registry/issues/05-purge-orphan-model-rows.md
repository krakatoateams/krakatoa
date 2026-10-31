# Clean up settings left behind by models developers retired, and document how to retire one

Status: done (reduced scope: runbook only)
GitHub: https://github.com/krakatoateams/krakatoa/issues/429
Blocked by: 04

## Overview

Scope was reduced after research (orchestrator scratchpad `model-retirement-research.md`, 2026-10-31).
This issue now delivers only a developer guide on how to retire a model without breaking anyone's past
creations. There is no "Delete permanently" button. Users notice nothing; past creations and charges are
never touched.

## Research-backed decisions

| Question | Decision |
| --- | --- |
| Archive vs hard delete for referenced catalog rows | Archive, keep indefinitely, no timed purge (Stripe, Google AIP-164). |
| Hard delete of orphan rows in the UI | Dropped. Orphans are ignored by the runtime, so deleting them helps no user. Deleting also removes a guard: a missing row means "shipped default", so a returning id would be offered without an admin choosing to (Unleash name-reuse risk). If a purge is ever needed, a developer writes a reviewed, idempotent migration. |
| If a delete button is ever requested anyway | Owner-only; only rows archived for at least 30 days; dry-run by default; typed model id checked server-side; orphan re-check in the same request; one audit row with the full deleted rows; no cascade. |
| Re-enable a model without a price | Block (already `PRICING_NOT_READY`). |
| Disable the current default | Two steps: pick a new default first (already `IS_DEFAULT`). |
| New models shipped in code | Ship dark by default; an admin enables after pricing. Follow-up outside this issue; existing live models grandfathered. |
| Skills that designate a removed model | Allow the removal; never cascade-delete the skill; fall back to the live default; the remove dialog names the affected skills. |

## Implementation Requirements

1. **Developer runbook** `docs/admin/retiring-a-generation-model.md`, linked from
   `docs/admin/adding-a-generation-model.md` ("Retiring a model"). Steps:
   1. archive in Admin Config first;
   2. wait until no in-flight jobs remain and the 72 h reconcile window has passed;
   3. keep the registry entry (`offeredByDefault: false`); if an entry must ever leave the registry,
      add a retired-label map read by `lib/creation-model-label.ts` first;
   4. remove it from code defaults/FALLBACKS and composer eligibility;
   5. deprecate pricing rows with an additive migration (pattern 040);
   6. leave the `model_catalog_configs` row archived and the `feature_model_configs` rows in place,
      never delete them;
   7. never reuse a retired id, slug or pricing key.

   Precedent: 040/041 Kling 2.0, 113 GPT Image 2.
2. **Never deleted** by anything the runbook prescribes: `model_catalog_configs`,
   `feature_model_configs`, `pricing_configs` (use `is_deprecated`), `provider_model_costs`,
   `model_configs`, jobs, assets, `generation_predictions`, `usage_events`, `credit_transactions`, user
   creations, audit log.
3. **Removed from scope:** the `GET/DELETE /api/admin/config/model-catalog/orphans` endpoints, the
   "Leftover settings" UI and the `model_purge` audit action.

## Technical Notes (verified in code)

- Runtime readers iterate code defaults and ignore DB rows for unknown ids (`getEnabledCatalogModelIds`,
  `getPhotoFeatureEnablement`, `getVideoComposerEnablement`), so orphans are harmless at runtime.
- `ensureFeatureModelRows` / `ensureModelCatalogRows` only insert missing rows; they never delete.
- `lib/model-catalog-guard.ts` already enforces `PRICING_NOT_READY` and `IS_DEFAULT`.
- Checked while writing the runbook (separate follow-ups, not fixed here):
  - shipping dark is opt-in today (a missing `offeredByDefault` means offered);
  - the remove dialog's "Skills that use it" reads only `skill_configs.model_id`, so a code-default
    skill designation (`lib/skills.ts` `modelId`) is not listed, and it shows skill ids, not titles.

## Acceptance Criteria

1. The runbook exists, is linked from `docs/admin/adding-a-generation-model.md`, and covers the steps
   above, including "archive, never delete, the config row" and "never reuse a retired id".
2. No code deletes rows from `model_catalog_configs` or `feature_model_configs`.
3. `npm run ci:checks` passes. English-only copy.

## Comments
