## Why

Krakatoa's legacy admin panel (`/admin/config`) splits configuration across three flat
tabs (Tools, Pricing, Models). Operators cannot see how a **tool → model → mode → price**
fits together, and video composer enablement is not persisted. A unified tree at
`/admin/config-v2` (~90% wired) matches the product mental model and must become the
**only** admin config surface after parity work and remaining persistence layers land.

## What Changes

- **Complete** the config v2 tree: video composer persistence, optional model on/off,
  legacy cutover, and (later) schema-driven provider editing.
- **Formalize** the three-layer architecture: product tree, pipeline roles, provider
  bindings — documented in `docs/admin/admin-config-v2-plan.md`.
- **Retire** `app/(app)/admin/config/page.tsx` after parity checklist passes.
- **Extend** `feature_model_configs` (or equivalent) for video composers under `tool_key =
  'reels'`.
- **Keep** billing globals (margin, FX) out of scope — Adit's panel.

## Capabilities

### New Capabilities

- `admin-config-v2`: Unified admin control panel — tree builder, pipeline registry,
  persistence contracts, studio integration for enablement/defaults, and cutover from
  legacy config.

### Modified Capabilities

- Photo studio and Video studio read paths for model enablement (after video composer
  persistence lands).
- `AdminNav` — single Config link post-cutover.

## Impact

- **Frontend:** `app/(app)/admin/config-v2/page.tsx` (primary); eventual removal of
  `app/(app)/admin/config/page.tsx`.
- **Lib:** `lib/admin-config-tree.ts`, `lib/admin-pipeline-config.ts`, new or extended
  `lib/video-composer-features.ts`, `lib/feature-model-configs-db.ts`.
- **API:** `/api/admin/config/feature-models`, new `/api/tools/video/features` (mirror
  photo).
- **DB:** Migration seeding video composer rows in `feature_model_configs`.
- **Docs:** `docs/admin/admin-config-v2-plan.md` (authoritative plan).

## Current State (Pre-Apply)

The following are **already implemented** in the prototype — agents should not rebuild:

- Tree builder merging `VIDEO_MODELS`, `PRODUCT_PHOTO_TIERS`, pricing DB + fallbacks
- Photo mode matrix persistence + exclusive defaults (`normalizeDefaultsPerMode`)
- Pipeline UI (Reels Creator, Veo engine, Storyboard hybrid)
- Pricing Option A (credits as source of truth)

See `docs/admin/admin-config-v2-plan.md` §3 for the full shipped/pending matrix.
