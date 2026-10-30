# Make turning a model on or off in Admin Config safe, logged and conflict-proof

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/426
Blocked by: 01

## Overview

Today an admin can switch off every model of a tool by accident, which would stop users from creating anything, and nobody can see who did it. After this change the app refuses unsafe switches with a clear reason (for example "this is the default, pick another default first"), records who changed what, and stops two admins from silently overwriting each other. Users notice nothing unless a model is switched off, in which case it simply disappears from their choices.

## Implementation Requirements

1. Harden the existing `PATCH /api/admin/config/model-catalog/[id]` (`withAdmin`). Body: `{ enabled: boolean, expectedUpdatedAt: string }`.
   - Load the row, the rows `checkModelCatalogChange()` needs (catalog, feature-model, pricing; active provider), and run it. Rejections → 409 `{ code, reasons }` with English reasons. Unknown/orphan `model_id` → 409 `UNKNOWN_MODEL`.
   - Same target state → 200 with the row, no write, no audit row (idempotent).
   - Compare-and-set: `update ... where id = :id and updated_at = :expectedUpdatedAt`; zero rows updated → 409 `STALE_MODEL_CONFIG` with the current row. Missing `expectedUpdatedAt` → 400.
   - Keep resetting the in-process enablement caches as `updateModelCatalogConfig` does today.
   - The guard read and the CAS write are not one transaction; that is acceptable because the CAS on the target row rejects concurrent edits to the same model, and the remaining race (two admins disabling two different last models at the same instant) is documented in the runbook. ponytail: per-tool advisory lock RPC if it is ever seen in practice.
2. Apply the same guard to `PATCH /api/admin/config/feature-models/[id]` when it sets `enabled: false` (last enabled model of that feature/composer) and when it unsets a default without a replacement. Setting a new default stays allowed and is how the admin clears the `IS_DEFAULT` block. Add `expectedUpdatedAt` CAS there too.
3. Audit: add `recordModelConfigChange({ actorProfileId, action, toolKey, modelId, before, after })` next to `recordProviderChange` in `lib/admin-config-audit-db.ts`, writing `admin_config_audit_log` with `action` `model_enable` / `model_disable` (and `feature_model_update` for item 2), `config_key = modelId` (or `featureKey:modelId`), `from_value` / `to_value` as JSON strings of the before/after state. Best-effort like `recordProviderChange` (never blocks the change, logs via `errorLogSafe`).
4. UI (`app/(app)/admin/config-v2/page.tsx`): `commitModelCatalog` and `commitFeatureMode` send `expectedUpdatedAt` and update it from each response. On 409 guard rejection: revert the toggle and show the reasons inline next to the model (accessible: `aria-live="polite"`). On 409 `STALE_MODEL_CONFIG`: refresh the row and show "Someone else changed this model. Review and try again." Disable the toggle with a tooltip/reason when the registry (issue 01) already says the action is blocked. English only, dark-first, no spinner for loading content (skeletons); a small inline spinner is fine for the save action.
5. Document in `docs/admin/admin-config-v2-plan.md` (Phase 3 section): guard rules, CAS, audit actions, the documented race, and that changes apply on the next generation request (enablement caches have TTL 0) while in-flight jobs are untouched.

## Technical Notes (verified in code)

- Current PATCH (`app/api/admin/config/model-catalog/[id]/route.ts`) validates only `typeof enabled === "boolean"`, then `updateModelCatalogConfig`: no guard, no audit, no concurrency check.
- The page autosaves with a retry loop (`commitModelCatalog`, ~line 1491) that re-sends the latest pending value; it must carry and refresh `expectedUpdatedAt` or every second click becomes a 409.
- `admin_config_audit_log` (117) columns: `actor_profile_id, action, tool_key, config_key, from_value, to_value, created_at`; app writes are best-effort and the app works without the table.
- `ctx.profile.id` is the actor (`CurrentAdmin` = `{ admin, profile }`, `lib/admin-auth.ts`).
- Generation routes only check enablement at request start (see issue 01 notes), so a running job is never affected by a disable.
- UNVERIFIED (check during implementation, add a test if true): a recoverable job retried by resubmitting to the generate route with the same idempotency key would be rejected with 400 if its model was disabled meanwhile, and its retained credits would wait for terminal refund via `shouldRefundRecoverableTerminal()`. If a retry path re-runs the enablement check, decide (and record in the runbook) whether identical retries of an already-charged attempt bypass enablement; never refund outside the canonical policy.

## Acceptance Criteria

1. Extend `lib/model-catalog-guard-self-check.ts` (or add a route-level self-check with an in-memory store) using the REAL guard and enablement functions: disabling the last enabled photo model of a feature → 409 `LAST_ENABLED_MODEL`; disabling the default → 409 `IS_DEFAULT`, then setting another default via the feature-model endpoint and retrying → 200; enabling with pricing not ready → 409 `PRICING_NOT_READY`; stale `expectedUpdatedAt` → 409 `STALE_MODEL_CONFIG` and no write; repeating the same request → 200 no-op with no second audit row; non-admin → 403.
2. Every successful enable/disable writes one audit row with correct before/after JSON; an audit insert failure does not fail the change.
3. Default behavior for users is unchanged when no admin acts (no rows written by deploy). Disabling a model removes it from `/api/tools/photo/features` and `/api/tools/video/features` on the next request and the generate route rejects it with the existing English 400.
4. Config v2 UI shows reasons for blocked actions and the stale message; manual check documented in the PR. `npm run ci:checks` passes. No migration. No change to credit prices, provider binding or billing.

## Comments
