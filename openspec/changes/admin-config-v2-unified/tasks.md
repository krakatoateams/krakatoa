## 1. Documentation (done)

- [x] 1.1 `docs/admin/admin-config-v2-plan.md` — authoritative plan
- [x] 1.2 `docs/admin/admin-config-v2-ringkasan.md` — Indonesian summary
- [x] 1.3 OpenSpec change `admin-config-v2-unified` (this folder)

## 2. Prototype verification (done — do not redo)

- [x] 2.1 Tree builder: video + photo models, pricing fallback, `normalizeDefaultsPerMode`
- [x] 2.2 Config v2 UI: tool toggles, mode tables, variant tables, override dialog
- [x] 2.3 Pipeline section: `PIPELINE_GROUP_SPECS`, role display, storyboard pricing
- [x] 2.4 Photo: 10 tiers visible via `V2_PRICING_DEFAULTS` fallback

## 3. Phase 1 — Cutover (P0)

- [ ] 3.1 Run parity checklist (`docs/admin/admin-config-v2-plan.md` §8)
- [ ] 3.2 Redirect `/admin/config` → `/admin/config-v2` (or in-place replace)
- [ ] 3.3 Update `AdminNav.tsx` — single "Config" link
- [ ] 3.4 Delete `app/(app)/admin/config/page.tsx` after bake
- [ ] 3.5 Apply migration `046_reels_tool_display_name_video.sql` via Supabase MCP

## 4. Phase 2 — Video composer persistence (P0)

- [ ] 4.1 Add `lib/video-composer-features.ts` (or extend `creation-features.ts`):
      composer keys, `defaultVideoComposerRows()`, `eligibleModelsForComposer()`
- [ ] 4.2 SQL migration: seed `feature_model_configs` for `tool_key = 'reels'` composer matrix
      (idempotent `on conflict do nothing`)
- [ ] 4.3 Extend `feature-model-configs-db.ts` GET merge for video rows
- [ ] 4.4 Update `buildVideoFeatures()` to read DB like `buildPhotoFeatures()`
- [ ] 4.5 Add `GET /api/tools/video/features` (mirror `app/api/tools/photo/features/route.ts`)
- [ ] 4.6 Wire Video studio to load composer enablement + default snapping
- [ ] 4.7 Config v2: `modesPersist` for `tool.toolKey === 'reels'`; Save modes batch

## 5. Phase 3 — Generation model on/off (P1)

- [ ] 5.1 Design minimal `(tool_key, model_id, enabled)` storage
- [ ] 5.2 Admin UI: model-level On checkbox on model card header
- [ ] 5.3 Studio APIs filter disabled models (admin tree still shows them)

## 6. Phase 4 — Provider binding editor (P1, blocked)

- [ ] 6.1 Fetch/cache Replicate model schema per `owner/name`
- [ ] 6.2 `<details> Provider` under each generation model — schema-driven fields
- [ ] 6.3 Pipeline roles: same editor; enable PATCH provider/model/parameters
- [ ] 6.4 Shared validator in `admin-config-validation.ts`

## 7. Phase 5 — Polish (P2)

- [ ] 7.1 Infrastructure section: `render.rendi`
- [ ] 7.2 Optional: seed extended photo `model_configs` rows in migration
- [ ] 7.3 Add `lib/admin-config-tree.test.ts` (defaults, pricing fallback, pipelines)
- [ ] 7.4 Update `CLAUDE.md` admin section with link to plan doc

## 8. Verification

- [ ] 8.1 `npm run lint`
- [ ] 8.2 Manual: Photo default change → studio within ~60s
- [ ] 8.3 Manual: Video composer toggle persists after refresh (post Phase 2)
- [ ] 8.4 Manual: Single default per mode across models (no duplicate checkboxes)
