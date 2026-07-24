## Context

- **Legacy admin** (`app/(app)/admin/config/page.tsx`): ~1,150 lines; Tools + Pricing +
  Models tabs. Pricing grouped by `pricing_group`. Photo uses feature-first tables;
  Video pipeline roles (`reels.llm`, `veo.tts`, `storyboard.image`) in separate model
  definition tables. Operators reported difficulty skimming long pricing lists.
- **Config v2** (`app/(app)/admin/config-v2/page.tsx`): Tree `Tool → Model → Mode →
  Variant` + collapsed **Pipeline**. Built from `buildAdminConfigTree()` in
  `lib/admin-config-tree.ts`. Loads tools, pricing, feature-models, model_configs,
  billing_settings.
- **Registries:** Video (`lib/video-models.ts`), Photo (`lib/product-photo.ts` +
  `lib/creation-features.ts`), pricing fallbacks (`lib/pricing-defaults.ts`), pipeline
  groups (`lib/admin-pipeline-config.ts`).
- **Runtime:** `pricing-resolver.ts` and `model-resolver.ts` with ~60s TTL cache;
  admin edits live within one cache cycle.

## Goals / Non-Goals

**Goals:**

- Single admin URL for product configuration (tools, models, modes, variant pricing,
  pipeline role enablement).
- Persist video composer enablement + defaults the same way Photo already does.
- Preserve **Option A pricing**: admin edits `credit_amount`; `provider_cost_usd` is
  reference only.
- Keep pipeline roles grouped by composer (Reels Creator, Veo engine, Storyboard sheet).
- Document alignment contracts so future agents don't break three-way sync (code / SQL /
  `admin-config-defaults.ts`).

**Non-Goals:**

- Billing global settings UI (margin, `usd_to_idr`, bonus grants).
- Payment / Xendit / subscriptions.
- Provider parameter editor without Replicate input_schema (Phase 4 — separate change).
- DB-only model catalog replacing code registries.

## Decisions

### 1. Tree shape: model-first, not feature-first

**Decision:** Config v2 lists **generation models** under each tool; each model exposes
**modes** it supports (filtered by capability). Legacy Photo tab was feature-first
(image / product / character sections each listing models).

**Rationale:** Matches how creators pick a model then a mode in Video/Photo studio.
Reduces duplicate model rows.

**Photo exception:** Mode matrix still maps to `feature_model_configs` `(feature_key,
model_tier)` — only the **UI axis** flipped to model-first.

### 2. Three layers: tree, pipeline, provider

**Decision:**

| Layer | What | Where in UI |
|-------|------|-------------|
| Product tree | Catalog + modes + pricing | Main model cards |
| Pipeline | Fixed LLM/TTS/Whisper/storyboard roles | Collapsed **Pipeline** per tool |
| Provider binding | `model_configs` overrides | Read-only now; **Advanced** per model later |

**Rationale:** Users never "pick" Gemini for scripting — it's internal to Reels Creator.
Mixing pipeline roles into the model list caused duplicate-default confusion (fixed by
`normalizeDefaultsPerMode`).

### 3. Storyboard hybrid (Photo sheet + Video clip)

**Decision:**

- **Photo tool → Pipeline → Storyboard sheet:** `storyboard.scene_llm`, `storyboard.image`
  + storyboard image/import pricing variants.
- **Video tool → Models with `storyboard` composer:** user picks video model for
  storyboard-to-video; Pipeline group `storyboard-video` is descriptive + lists eligible
  models only.

**Rationale:** Matches `photo-v2` Storyboard creation type and `generate-storyboard-video`
using selected `VIDEO_MODELS` entry — not `storyboard.video` config row.

**Alternative rejected:** Fourth `PHOTO_FEATURES` row for storyboard — would wrongly imply
per-tier Nano/FLUX matrix for a fixed GPT Image pipeline.

### 4. Video composer persistence — extend `feature_model_configs`

**Decision:** Reuse `feature_model_configs` with `tool_key = 'reels'`, `feature_key` ∈
`{ text2video, image2video, motion_control, storyboard, reels-creator }`, `model_tier` =
`VIDEO_MODELS[].id` (and motion control ids).

**Rationale:** Table already exists; photo pattern proven; avoids new migration surface.

**Shipped defaults:** Code helper `defaultVideoComposerRows()` mirroring
`defaultFeatureModelRows()` — materialized on admin GET like photo.

**Eligibility:** Rows only for capability-eligible pairs; admin cannot enable impossible
modes (hard gate in tree builder, same as photo `requiresReference`).

### 5. Pricing fallback in tree builder

**Decision:** `variantFromPricingRow()` uses DB row when present; else
`getV2PricingDefault()` — identical fallback chain to `pricing-resolver.ts`.

**Rationale:** Extended photo models lacked DB rows; tree previously hid them (`variants
.length === 0` filter). Runtime already charged correctly from built-in defaults.

### 6. Default exclusivity

**Decision:** Exactly one `isDefault` per mode key across all models in a tool.
`normalizeDefaultsPerMode()` on build; UI override dialog on conflict.

**Rationale:** Studio needs unambiguous default when user hasn't picked a model.

### 7. Cutover strategy

**Decision:** Soft launch already done (`AdminNav` → "Config v2"). Full cutover:

1. Parity checklist (§8 in plan doc)
2. Redirect `/admin/config` → `/admin/config-v2` OR replace page component in place
3. Delete legacy page after bake period

**Rationale:** Avoid two diverging panels; legacy is reference until parity signed off.

### 8. Provider ID editing deferred

**Decision:** Pipeline and model cards show `provider/model` read-only until
schema-driven editor exists (Replicate model OpenAPI per `owner/name`, safe parameter
whitelist, Whisper `parameters.version` pin).

**Rationale:** Raw text fields caused production typos; user explicitly deferred.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Video composer seed drift vs code registry | Single `defaultVideoComposerRows()`; CI test comparing counts |
| `feature_model_configs` name confusing for video | Comment + optional view alias later; no rename in v1 |
| Large Video model list UX | Keep collapsed accordions; default open only balanced/seedance2_fast |
| Cache staleness after admin save | Keep existing "~60s" notice; optional cache bust endpoint later |

## Migration Plan

1. Ship video composer migration + API (no UI change required beyond persist flag)
2. Wire studio `/api/tools/video/features`
3. Enable Save modes on Video in config v2
4. Parity QA
5. Redirect + delete legacy
6. (Later) Provider schema editor

Rollback: legacy page kept in git; redirect reversible until deletion.

## Open Questions

- Should deprecated pricing rows appear in v2 (read-only section) or stay hidden?
- Per-model **global** off switch: new table vs aggregate "all modes disabled"?
- `storyboard.video` model_config row — deprecate or document as unused?

## Reference

Full plan: [`docs/admin/admin-config-v2-plan.md`](../../../docs/admin/admin-config-v2-plan.md)
