# Admin Config: add and remove generation models (design note)

Status: ready-for-agent
Issues: #425 (01) → #426 (02) → #427 (03) → #428 (04) → #429 (05), Blocked-by chain in that order

Request (user, translated): "In the admin page, Config menu, let an admin ADD a model or REMOVE a
model. Think about the most robust way and best practice." Written while the user was asleep: every
decision below picked the most conservative option and is listed under Open questions for review.

## Decision summary

1. **No new registry.** The code catalog that already exists stays the only source of truth for
   which models EXIST: `defaultModelCatalogRows()` in `lib/model-catalog-configs.ts` already merges
   `PRODUCT_PHOTO_TIERS` (photo), `VIDEO_MODELS` and `MOTION_CONTROL_MODELS` (reels). Reels Creator
   engines (`lib/reels-models.ts`) are not a fourth list: they map onto catalog ids through
   `REELS_ENGINE_CATALOG_MODEL_ID`. The DB table `model_catalog_configs` (migration 048) stays the
   only place for whether a model is OFFERED. Pipeline roles (LLM, TTS, Whisper, storyboard image,
   Rendi) are not catalog models and stay out of scope: they change only through the existing
   provider switch.
2. **"Add" means "add from the catalog".** An admin can only offer a model that a developer already
   shipped in code (adapter, parameter mapping, output normalizer, trusted output hosts, pricing
   keys, labels). Adding a brand-new model slug from the UI is rejected as unsafe; it stays a
   developer task with a written checklist (issue 03). Developers can ship a model "dark" (in code,
   not offered) so an admin adds it when pricing is ready.
3. **"Remove" is soft by default.** Remove means archive: hidden from users and from the main admin
   list, kept in a "Removed models" section, history keeps rendering, pricing rows kept, reversible
   with Restore (issue 04). Hard delete only purges DB config rows for models that are no longer in
   code (orphans) and does nothing to history, jobs or pricing (issue 05).
4. **Every write is guarded on the server** by one pure function, `checkModelCatalogChange()`, driven
   by the real code catalog, real composer/feature enablement and real pricing rows (issue 01 builds
   it, 02 wires it).
5. **No migration is needed for issues 01–03.** `model_catalog_configs` (048) and
   `admin_config_audit_log` (117) already exist. Issue 04 adds one additive column (`archived_at`);
   until it is applied, Remove/Restore are visibly disabled with the reason and everything else
   works as today.

## Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Admin types a new provider slug and raw parameter JSON | Breaks the FINAL decision that provider + model + parameters switch as one unit from a code catalog. Each model needs a code adapter, input mapping, output normalizer and trusted output hosts (e.g. `isTrustedFalOutputUrl` in `lib/ai-providers/fal-photo-catalog.ts`) and its own pricing keys. A bad slug would fail at generation time after the credit spend. |
| A new `models` table as a DB-only registry | Would be a fifth source of truth. `docs/admin/admin-config-v2-plan.md` §10 already lists "replacing code registries with DB-only catalog" as a non-goal. |
| Hard delete of a `model_catalog_configs` row as "remove" | Unsafe: a missing row means "shipped default", so deleting the row of a model still in code silently **re-enables** it (`getEnabledCatalogModelIds`). |
| Using `model_configs.enabled = false` as "remove" | Does not remove anything: the resolver ignores a disabled row and falls back to the code default model (`lib/model-resolver.ts` `isUsable`). |
| Deleting the model's entry from the code registry | `getProductPhotoTier`, `getVideoModel` and `getMotionControlModel` silently fall back to the DEFAULT model for an unknown id, and history labels come from the code registry (`lib/creation-model-label.ts`). Removing an entry would mislabel history. Retiring from code is a separate developer runbook (issue 05). |
| Auto-reassign the default when its model is disabled (atomic multi-row RPC) | More moving parts. Two simple steps are atomic on their own: the admin first picks another default (existing feature-model endpoint), then disabling is allowed. |
| Storing the archived flag in `metadata` jsonb to avoid a migration | Works tonight but is not queryable or constrained. A real column is clearer; the feature can stay inert until the migration is applied. |

## Data model

- Unchanged: `model_catalog_configs (tool_key, model_id, enabled, sort_order, metadata,
  updated_by_profile_id, created_at, updated_at)`, unique `(tool_key, model_id)`, `updated_at` set by
  the `krakatoa_set_updated_at` trigger (048). Missing row = code default.
- Code: catalog entries gain an optional `offeredByDefault?: false` flag (issue 03). Missing flag =
  today's behavior (offered). `defaultModelCatalogRows()` passes it through as `enabled`.
- Issue 04 additive migration (next free number, today `118_model_catalog_archive.sql`):
  `alter table model_catalog_configs add column if not exists archived_at timestamptz;` and
  `add column if not exists archived_by_profile_id uuid references profiles (id) on delete set null;`
  Check: `archived_at is null or enabled = false` (added `not valid` then validated, idempotent with
  a `do $$ ... if not exists` guard).
- Audit: reuse `admin_config_audit_log` (117). `config_key` holds the catalog `model_id`; `action` is
  one of `model_enable`, `model_disable`, `model_add`, `model_archive`, `model_restore`,
  `model_purge`; `from_value` / `to_value` hold a JSON string of the before/after state.

Lifecycle (derived, never stored as text):

| State | Meaning | Users see it |
| --- | --- | --- |
| Offered | `enabled = true`, not archived | yes, in eligible composers/features where also enabled |
| Not offered | `enabled = false`, not archived (includes shipped-dark models never added) | no |
| Removed | `archived_at` set (implies `enabled = false`) | no; history still renders |
| Orphan | DB row whose `model_id` is no longer in code | no; only hard delete applies |

## Invariants (enforced server-side by `checkModelCatalogChange()`)

1. Every tool family keeps at least one offered model, and every composer/feature that is currently
   usable keeps at least one enabled model after the change.
2. A model that is the effective default of any composer/feature (DB `is_default` or the code
   default the runtime would pick: `defaultTierForFeature`, `defaultModelForComposer`) cannot be
   disabled or removed until another default is chosen for each of those composers.
3. A model that a Reels Creator engine runs on (`REELS_ENGINE_CATALOG_MODEL_ID`) cannot be disabled
   or removed while that engine is the last engine offered (Reels Creator would break).
4. A model can only become offered when every pricing key it bills through has a `pricing_configs`
   row that is enabled, not deprecated and has an integer `credit_amount >= 0`. Otherwise the
   resolver falls back to the built-in provider-cost default, which turns a cost reference into
   the price users pay. Note: `credit_amount` is `int not null` in the DB (007), so the realistic
   failure is a missing, disabled or deprecated row.
5. A model can only become offered when its active provider is configured (`isProviderConfigured`,
   e.g. `FAL_KEY` for a Fal-bound photo tier).
6. Writes are compare-and-set on `updated_at` (stale → 409 `STALE_MODEL_CONFIG`), idempotent (same
   target state → 200 no-op, no audit row), admin-only (`withAdmin`), and audited.
7. In-flight and finished jobs, assets, predictions, usage events and credit transactions are never
   touched. Billing above the provider layer, credit prices and defaults for users are unchanged.

## Failure modes

| Failure | Behavior |
| --- | --- |
| DB unreachable on a generation request | Unchanged: enablement readers return code defaults (never throw). |
| Two admins edit the same model | Second write gets 409; UI refreshes the row and shows "Someone else changed this model. Review and try again." |
| Audit insert fails | Change still applies (existing best-effort contract of `recordProviderChange`); failure is logged without secrets. |
| Migration 118 not applied | Remove/Restore buttons disabled with "Apply migration 118 to enable Remove"; GET still works; PATCH archive returns 409 `MIGRATION_REQUIRED`. |
| Pricing row edited to disabled after a model is offered | Not blocked here (pricing is a separate screen); the registry view flags the model "Pricing not ready". |
| Admin disables a model while a user has it open | Next submit is rejected with the existing English 400 ("isn't available"); in-flight work finishes. |

## Test plan

- `lib/model-catalog-guard-self-check.ts` (`npm run test:model-catalog-guard`, wired into
  `ci:checks`): drives the REAL `checkModelCatalogChange()` with the REAL `defaultModelCatalogRows()`,
  `eligibleTiersForFeature`, `eligibleModelsForComposer`, `defaultTierForFeature`,
  `defaultModelForComposer` and per-model pricing keys; only the DB rows are in-memory fixtures.
- Each later issue extends that self-check plus route-level checks for 401/403, 409 stale, idempotent
  repeat, audit row content, and migration-missing behavior.
- Existing `test:admin-config-validation`, `test:admin-config-tree`, `test:admin-config-toggles`,
  `test:admin-config-persistence` stay green. `npm run lint`, `npm run typecheck`, `npm run build`.

## Open questions for the user (defaults already chosen; nothing is blocked)

1. **Re-enabling a model priced only by the built-in default.** Default: blocked until a pricing row
   exists. Alternative: allow with a warning.
2. **Who can hard delete orphans.** Default: owners only (`admin_users.role = 'owner'`). Alternative:
   any admin.
3. **Is hard delete (issue 05) wanted at all?** Orphan rows are ignored by the runtime, so issue 05
   is optional. Default: keep it, scoped to orphans only.
4. **Disabling a model that is a default.** Default: blocked until the admin picks another default
   (two steps). Alternative: one dialog that picks the replacement and disables in one go (needs an
   RPC migration).
5. **Shipped-dark models.** Default: new code entries keep today's behavior (offered on deploy)
   unless the developer sets `offeredByDefault: false`. Alternative: every new model ships dark.
6. **Skills that designate a removed model.** Default: Remove is allowed and the impact preview lists
   them; those skills fall back to the live default as they do today when a model is disabled.
   Alternative: block Remove while any skill designates it.
7. **Pipeline roles (LLM/TTS/Whisper/storyboard image).** Default: out of scope. Confirm.
