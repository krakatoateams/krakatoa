# Let admins remove a model safely (reversible), with a preview of what it affects

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/428
Blocked by: 03

## Overview

Admins get a "Remove" action for a model. It hides the model from users and tidies it out of the main admin list, while every past photo and video made with it keeps showing correctly and its prices are kept. Before confirming, the admin sees what the model is used by (for example, how many creations are still running), and a removed model can be brought back at any time with "Restore".

## Implementation Requirements

1. **Migration** (next free number, today `supabase/migrations/118_model_catalog_archive.sql`), additive and idempotent, header comment in the repo's style:
   - `alter table model_catalog_configs add column if not exists archived_at timestamptz;`
   - `alter table model_catalog_configs add column if not exists archived_by_profile_id uuid references profiles (id) on delete set null;`
   - constraint `model_catalog_configs_archived_disabled` (`archived_at is null or enabled = false`) created only if missing (`do $$ ... $$` guard), so a removed model can never be offered.
   - `npm run db:setup` (`scripts/setup-db.mjs`) already applies every file in `supabase/migrations/`; no script change. The user applies migrations manually in the Supabase SQL editor.
2. **Tolerant code (migration may not be applied):** detect the missing column (PostgREST "column ... does not exist" / schema cache error) once per request; the registry returns `archiveAvailable: false`, the UI shows Remove/Restore disabled with "Apply migration 118 to enable Remove", and the archive endpoint returns 409 `MIGRATION_REQUIRED`. All other admin and runtime behavior is unchanged. Selecting `*` must keep working with or without the column.
3. **Endpoints** (`withAdmin`, CAS on `updated_at`, idempotent, audited with `model_archive` / `model_restore` via `recordModelConfigChange`):
   - `GET /api/admin/config/model-catalog/[id]/impact`: dry run, read-only. Returns: `checkModelCatalogChange` result for `archive`; composers/features where enabled or default; Reels engine use; skills designating it (`skill_configs.model_id`); pricing keys (kept); counts of in-flight jobs and of jobs, assets and usage events in the last 30 days and all time for the model's provider slugs. Slugs = registry `providerModel`, the current `model_configs` row model for its `modelRole`, and Fal slugs whose `FAL_PHOTO_MODELS[...].configKey` matches (catalog ids like `seedance2_fast` are not what `jobs.model` / `assets.model` / `usage_events.model` store). Use `count: "exact", head: true` queries; owner-scoping is not relevant (admin aggregate) but never return user ids or media.
   - `POST /api/admin/config/model-catalog/[id]/archive` `{ expectedUpdatedAt }`: runs the guard with change `archive` (same rules as disable: last enabled, default, Reels engine). Sets `enabled = false, archived_at = now(), archived_by_profile_id` in one CAS update. In-flight jobs are untouched.
   - `POST /api/admin/config/model-catalog/[id]/restore` `{ expectedUpdatedAt }`: clears `archived_at` and keeps `enabled = false` (restore never re-offers; the admin adds it again through the issue 03 flow, which re-checks pricing and provider).
4. **Guard:** extend `checkModelCatalogChange` with `archive` and `restore`; enabling an archived model through the PATCH is rejected with `ARCHIVED` (must restore first).
5. **UI:** "Remove" on a model opens an accessible confirm dialog (reuse `components/ui/ConfirmDialog.tsx` if it fits) showing the impact preview (skeleton while loading), the guard reasons if blocked, and the plain statement "Past creations keep working. Prices are kept. You can restore this model later." Typed confirmation is NOT required for soft remove (it is reversible). Removed models move to a collapsed "Removed models" section with Restore. English only, dark-first.
6. Studio/runtime: archived ⇒ `enabled = false`, so the existing readers already hide it; no runtime code change is needed beyond tolerating the new columns. History labels keep working because the registry entry stays in code.

## Technical Notes (verified in code)

- `jobs.model` and `assets.model` (003), `usage_events.model` (004), `generation_predictions.provider` (114) store provider slugs, not catalog ids. `skill_configs.model_id` (087) stores the catalog id for photo/video skills; the generate route already ignores a designated model that is not enabled (`app/api/generate-photo/route.ts` ~line 465).
- `pricing_configs` already has a soft flag `is_deprecated` (migration 010; used for Kling 2.0 in 040). This issue does NOT touch pricing rows; removing a model keeps its prices so Restore is exact.
- Precedent: Kling 2.0 was soft-deprecated (040) then hard-deleted by migration (041) when proven unused; `113` rewrote a retired slug. This issue gives admins the soft half without SQL.
- UNVERIFIED: the exact `jobs.status` values that mean in-flight (check `lib/` job status helpers before writing the count query; count only non-terminal statuses).

## Acceptance Criteria

1. Self-check with the REAL guard: archive of the last enabled model / a default / the last Reels engine is rejected; archive of a normal model passes; enabling an archived model is rejected with `ARCHIVED`; restore leaves it not offered; repeated archive/restore is a no-op without duplicate audit rows; stale `expectedUpdatedAt` → 409.
2. With the migration NOT applied: admin Config v2 loads, toggles from issue 02 work, Remove/Restore are visibly disabled with the reason, archive returns 409 `MIGRATION_REQUIRED`, generation is unaffected. With it applied: full flow works. Migration re-runs cleanly.
3. Impact endpoint is read-only (no writes, verified by test), admin-only (401/403), and its counts match a seeded fixture for slug mapping (photo tier with a Fal binding counts both slugs).
4. After archive: the model disappears from studio feature endpoints on the next request; a job already running on it completes and is charged once exactly as before; its history item keeps its label.
5. Audit rows for archive/restore with before/after JSON. `npm run ci:checks` passes. English-only copy. No change to credit prices, pricing rows or billing.

## Comments
