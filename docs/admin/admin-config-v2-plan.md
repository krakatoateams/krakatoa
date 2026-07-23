# Admin Config v2 — Unified Control Panel Plan

> **Status:** ~90% prototype wired (March 2026). UI lives at `/admin/config-v2`.
> Legacy panel at `/admin/config` remains until cutover.
>
> **Audience:** Future agents implementing the full refactor, cutover, and remaining
> persistence layers. Read this before touching admin config, pricing display, or
> model enablement.

---

## 1. Purpose

Replace the legacy three-tab admin panel (**Tools · Pricing · Models**) with a **single
tree-based control panel** where an operator configures everything a creator sees and
pays for, in product order:

```
Tool (on/off, sidebar)
└── Generation model (catalog entry)
    ├── Mode / composer (how the model is used)
    └── Cost variant (resolution, audio, reference video, tier, …)
        ├── Replicate $  (provider reference — update when Replicate reprices)
        └── Credits      (what users pay — source of truth, Option A)
```

**Pipeline roles** (LLM, TTS, Whisper, storyboard scene LLM, etc.) are a **sibling
layer** under each tool — fixed internal steps, not user-picked models. Provider/model
ID editing for those roles is deferred until per-model **input_schema** UI exists.

**Billing globals** (margin, USD/IDR, bonus grants) stay in Adit's separate panel —
not part of this tree.

---

## 2. Vision vs legacy

| Legacy `/admin/config` | Config v2 `/admin/config-v2` |
|------------------------|------------------------------|
| Tools tab: flat tool toggles | Tool header: On + Sidebar + Save |
| Pricing tab: long flat list by `pricing_group` | Variants nested under each model |
| Models tab: feature-first (Photo) + pipeline tables (Video) | Model-first tree; Photo modes matrix per model |
| Storyboard pricing mixed in pricing dump | Storyboard sheet pricing under Photo → Pipeline |
| Reels pipeline roles in separate section | Video → Pipeline (Reels Creator, Veo engine, Storyboard→video) |

**Product naming:** DB `tool_key` remains `reels`; display name is **Video** (migration
`046_reels_tool_display_name_video.sql` may need MCP apply).

---

## 3. Current implementation (~90%)

### 3.1 Shipped in code

| Area | Status | Notes |
|------|--------|-------|
| Tree builder | ✅ | `lib/admin-config-tree.ts` merges DB + registries |
| Video models | ✅ | `VIDEO_MODELS` + `MOTION_CONTROL_MODELS` |
| Photo models | ✅ | All 10 `PRODUCT_PHOTO_TIERS` (pricing fallback via `V2_PRICING_DEFAULTS`) |
| Photo mode matrix | ✅ | Persisted via `feature_model_configs` |
| Default per mode | ✅ | Exclusive across models; `normalizeDefaultsPerMode()` |
| Pricing Option A | ✅ | Admin edits **Credits**; Replicate $ is reference + Suggest |
| Tool toggles | ✅ | `tool_configs` via PATCH |
| Pipeline section | ✅ | `lib/admin-pipeline-config.ts` + UI collapsed **Pipeline** |
| Storyboard hybrid | ✅ | Photo = sheet pipeline; Video = composer modes + hint |

### 3.2 Known gaps (intentional deferrals)

| Gap | Impact | Blocker |
|-----|--------|---------|
| Video composer toggles | Local UI only; refresh resets | No `feature_model_configs` rows for video composers |
| Video model on/off | All models always `enabled: true` in tree | No per-model enablement table for video |
| Provider ID edit | Read-only display in Pipeline | Needs `input_schema` per provider model |
| Provider override per generation model | Still in legacy Models tab | Same as above; merge into model card **Advanced** |
| `render.rendi` | Not in v2 | Infrastructure footer (low priority) |
| IG / Schedule / Calendar | Empty model lists in tree | No generation catalog — tool toggle only |
| Legacy cutover | Two panels coexist | Redirect + delete legacy after parity check |
| Extended photo `model_configs` seed | Resolver falls back to code | Optional DB rows for `image_seedream4`, etc. |

### 3.3 Bugs fixed during prototype (do not regress)

- **Duplicate defaults per mode:** `normalizeDefaultsPerMode()` after tree build.
- **Missing extended photo models:** `variantFromPricingRow()` falls back to
  `getV2PricingDefault()` when DB row absent (mirror `lib/pricing-resolver.ts`).

---

## 4. Target architecture

### 4.1 Mental model (three config layers)

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1 — Product tree (user-facing)                        │
│   Tool → Model → Mode → Variant (credits + provider $)    │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2 — Pipeline (fixed roles per composer)               │
│   Reels Creator: LLM, TTS, Whisper                          │
│   Storyboard sheet: scene LLM, image model                  │
│   Storyboard→video: uses Layer 1 models w/ storyboard mode  │
├─────────────────────────────────────────────────────────────┤
│ LAYER 3 — Provider binding (advanced, per model/role)     │
│   model_configs: provider, model id, parameters             │
│   Deferred: schema-driven parameter editor                  │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Data sources (single source of truth per dimension)

| Dimension | Code registry | DB table | Runtime reader |
|-----------|---------------|----------|----------------|
| Tool visibility | `TOOL_DEFAULTS` | `tool_configs` | `tool-configs-db` + routes |
| Photo mode × model | `PHOTO_FEATURES` + `defaultFeatureModelRows()` | `feature_model_configs` | `feature-model-configs-db` |
| Video mode × model | `VIDEO_COMPOSERS` in tree (capability from `video-models.ts`) | **TBD** — see §6.2 | Today: code-only eligibility |
| Generation catalog | `VIDEO_MODELS`, `PRODUCT_PHOTO_TIERS`, … | — | Import in tree builder |
| Provider IDs | `MODEL_DEFAULTS` + tier `providerModel` | `model_configs` | `model-resolver.ts` |
| User pricing | `V2_PRICING_DEFAULTS` | `pricing_configs` | `pricing-resolver.ts` |
| Pipeline role list | `PIPELINE_GROUP_SPECS` | — | Static registry |
| Billing knobs | `DEFAULT_BILLING_SETTINGS` | `billing_settings` | Adit's panel (out of scope) |

**Alignment rule:** When adding a photo feature, video composer, or pricing key, update
**all three**: code registry, SQL seed / migration (if DB-backed), and
`admin-config-defaults.ts` reset map. See comments in `lib/creation-features.ts`.

### 4.3 Video composers (capability matrix)

Defined in `lib/admin-config-tree.ts` as `VIDEO_COMPOSERS`:

| Key | Label | Eligibility |
|-----|-------|-------------|
| `text2video` | Text to video | `isTextToVideoModel` |
| `image2video` | Image to video | `isImageToVideoModel` |
| `motion_control` | Motion control | `MOTION_CONTROL_MODELS` only |
| `storyboard` | Storyboard to video | `isStoryboardVideoModelId` |
| `reels-creator` | Reels Creator | `REELS_CREATOR_MODEL_IDS` |

Incompatible modes are **hidden** (not shown as disabled).

### 4.4 Photo features

`lib/creation-features.ts` — `PHOTO_FEATURES`:

| Key | Label | Reference required |
|-----|-------|-------------------|
| `image` | Image generation | No |
| `product` | Product try-on | Yes |
| `character` | Character generation | No |

Storyboard sheet is **not** a fourth `PHOTO_FEATURES` row — it lives under **Pipeline**
(hybrid design). Photo UI creation type `storyboard` maps to pipeline + storyboard APIs,
not the product-photo tier matrix.

### 4.5 Pipeline groups (current registry)

`lib/admin-pipeline-config.ts`:

**Video (`adminToolKey: reels`)**

- `reels-creator` → `reels.llm`, `reels.tts`, `reels.whisper`
- `reels-creator-veo` → `veo.llm`, `veo.tts`, `veo.whisper`
- `storyboard-video` → description only; lists models with `storyboard` composer

**Photo (`adminToolKey: photo`)**

- `storyboard-sheet` → `storyboard.scene_llm`, `storyboard.image` + storyboard pricing keys

---

## 5. UI contract (config v2 page)

**File:** `app/(app)/admin/config-v2/page.tsx`

| Control | Persists to | Notes |
|---------|-------------|-------|
| Tool On / Sidebar | `tool_configs` | Save per tool |
| Mode On / Default (Photo) | `feature_model_configs` | Save modes = whole tool batch |
| Mode On / Default (Video) | — | Local state until §6.2 |
| Variant Credits / Replicate $ / On | `pricing_configs` | Per variant Save |
| Pipeline role On | `model_configs` | Requires DB row id |
| Pipeline provider/model | — | Read-only until input_schema |

**Default override:** Checking Default when another model holds it opens a non-dismissible
dialog; exclusive per mode across all models in the tool.

**Pricing math:** `suggestCreditsFromProvider()` uses `billing_settings` from
`/api/credits/pricing`. Custom credit amounts show amber **custom** badge.

---

## 6. Remaining work (implementation phases)

### Phase 1 — Cutover & parity (P0)

**Goal:** One admin config URL; legacy retired.

- [ ] Parity checklist vs legacy (see §8)
- [ ] Redirect `/admin/config` → `/admin/config-v2` (or replace page in place)
- [ ] Update `AdminNav.tsx` — remove "Config v2" beta label; single **Config** link
- [ ] Remove or archive `app/(app)/admin/config/page.tsx` after 2-week bake
- [ ] Apply migration `046` (Video display name) via Supabase MCP

### Phase 2 — Video composer persistence (P0)

**Goal:** Video mode toggles and defaults survive refresh; studio reads them.

**Option A (recommended):** Extend `feature_model_configs` to `tool_key = 'reels'` with
`feature_key` = composer keys (`text2video`, `image2video`, …) and `model_tier` = video
`model.id` (same shape as photo).

**Option B:** New table `composer_model_configs` — only if photo matrix pattern doesn't fit.

Tasks:

- [ ] Migration: seed rows from code matrix (all eligible pairs enabled; one default per mode)
- [ ] `lib/creation-features.ts` or new `lib/video-composers.ts` — shipped defaults helper
- [ ] API: reuse `/api/admin/config/feature-models` or scoped GET for video
- [ ] `buildVideoFeatures()` — read DB rows like `buildPhotoFeatures()`
- [ ] Studio: `/tools/video` loads composer enablement (mirror photo `/api/tools/photo/features`)
- [ ] Config v2: `persist={true}` for video modes; wire Save modes

### Phase 3 — Generation model on/off (P1)

**Goal:** Hide entire model cards from studio when disabled.

- [ ] Design: `model_catalog_configs` vs extend `feature_model_configs` with wildcard row
- [ ] Prefer minimal: single `enabled` flag per `(tool, model_id)` without per-mode explosion
- [ ] Tree builder filters disabled models from studio APIs (not from admin tree)

### Phase 4 — Provider binding UI (P1, blocked on schema)

**Goal:** Edit provider/model/parameters without raw text fields.

- [ ] Replicate OpenAPI / cached schema per `owner/name`
- [ ] Collapsed **Provider** under each generation model card (`modelRole` → `model_configs`)
- [ ] Pipeline roles use same editor component
- [ ] Validation: reject unknown parameter keys; version pin for Whisper in `parameters.version`

Until Phase 4: keep read-only `provider/model` in Pipeline table.

### Phase 5 — Infrastructure & minor tools (P2)

- [ ] Footer **Infrastructure**: `render.rendi` under global or Video pipeline
- [ ] IG / Schedule / Calendar: tool-only section (no model tree) with copy explaining scope
- [ ] Seed extended photo `model_configs` rows in migration (optional; resolver already works)

### Phase 6 — Billing boundary (out of scope here)

- Margin, `usd_to_idr`, `credit_value_idr`, bonus grants — Adit's panel
- Config v2 **reads** `billing_settings` only for Suggest button

---

## 7. File map (agent quick reference)

| File | Role |
|------|------|
| `app/(app)/admin/config-v2/page.tsx` | Main UI |
| `app/(app)/admin/config/page.tsx` | Legacy (delete after cutover) |
| `lib/admin-config-tree.ts` | Tree types + `buildAdminConfigTree()` |
| `lib/admin-pipeline-config.ts` | Pipeline group registry |
| `lib/admin-config-defaults.ts` | Reset-to-default maps |
| `lib/admin-config-validation.ts` | PATCH validators |
| `lib/creation-features.ts` | Photo feature catalog + defaults |
| `lib/video-models.ts` | Video catalog + `modelRole` |
| `lib/product-photo.ts` | Photo tier catalog |
| `lib/pricing-defaults.ts` | Built-in pricing fallback |
| `lib/pricing-resolver.ts` | Runtime pricing (mirror fallback rules in tree) |
| `lib/model-resolver.ts` | Runtime model IDs |
| `lib/feature-model-configs-db.ts` | Photo enablement DB |
| `app/api/admin/config/*` | Admin CRUD routes |

**APIs loaded by v2 page:**

```
GET /api/admin/config/tools
GET /api/admin/config/pricing
GET /api/admin/config/feature-models
GET /api/admin/config/models
GET /api/credits/pricing          → billing_settings for Suggest
PATCH /api/admin/config/tools/:key
PATCH /api/admin/config/pricing/:key
PATCH /api/admin/config/feature-models/:id
PATCH /api/admin/config/models/:id
```

---

## 8. Parity checklist (before legacy delete)

### Tools

- [ ] Every `tool_configs` row editable in v2
- [ ] Sort order preserved

### Pricing

- [ ] All non-deprecated v2 `pricing_configs` keys reachable from tree or pipeline variants
- [ ] Deprecated rows hidden (legacy showed read-only deprecated section — optional in v2)
- [ ] `initial_dummy_credits` stays in Adit/billing panel, not product tree

### Models / enablement

- [ ] Photo: all `(feature × tier)` rows match legacy feature table
- [ ] Video: composer matrix persisted (after Phase 2)
- [ ] Pipeline: all `PIPELINE_GROUP_SPECS` roles visible with correct fallback display

### Runtime smoke

- [ ] Change photo default tier → photo studio reflects within ~60s
- [ ] Change variant credits → generation quotes new price within ~60s
- [ ] Disable pipeline role → verify resolver behavior (enabled=false → fallback)

---

## 9. Testing notes

- **Tree builder:** `npx tsx -e "import { buildAdminConfigTree } from './lib/admin-config-tree.ts' …"`
- **Lint:** `npm run lint`
- **No dedicated test file yet** — add `lib/admin-config-tree.test.ts` when Phase 2 lands
  (defaults normalization, pricing fallback, pipeline merge)

Manual QA paths:

1. Video → expand Kling v2.1 → single default for image2video
2. Photo → 10 models visible
3. Photo → Pipeline → storyboard pricing editable
4. Video → Pipeline → Reels Creator roles show gemini/minimax/whisper ids

---

## 10. Non-goals

- Payment gateway / Xendit / subscriptions
- Credit balance UI in admin
- Client request idempotency for generations
- RLS policy overhaul (`rls_auto_enable` backlog)
- Replacing code registries with DB-only catalog (registries stay source of capability truth)

---

## 11. Related docs

- `docs/billing/pricing-config-v2-plan.md` — Pricing Option A (implemented)
- `docs/billing/pricing-config-v2-ringkasan.md` — Indonesian summary
- `openspec/changes/admin-config-v2-unified/` — OpenSpec change (proposal, design, tasks, spec)
- `CLAUDE.md` — Monorepo overview (link to this doc)

---

*Last updated: 2026-07-23 — reflects config v2 prototype through Pipeline + storyboard hybrid.*
