# Retire GPT Image 2: storyboard sheets move to GPT Image 2.5 Flare (same price)

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/403
Blocked by: 02 (#394 must be merged first; shared product-photo/storyboard files, avoid conflicts)

## Overview

The older GPT Image 2 model is no longer used by anyone except the storyboard sheet generator. This moves storyboard sheets to the newer GPT Image 2.5 Flare model, which the photo tools already use, and removes the old model from the product. What people pay for a storyboard stays exactly the same, and the sheets should look just as good.

## Implementation Requirements

- Remove `GPT_IMAGE_2_MODEL` (`"openai/gpt-image-2"`) from `lib/product-photo.ts:101-102` and repoint its users to `GPT_IMAGE_2_5_FLARE_MODEL`: `lib/model-resolver.ts` (import at `:4`, `FALLBACKS.storyboard.image` at `:147`) and `lib/admin-config-defaults.ts` (import at `:9`, `"storyboard.image"` default at `:454`). Fix the stale doc comment at `lib/product-photo.ts:101` and the "storyboard stays on GPT_IMAGE_2_MODEL" comment at `:104`.
- In `lib/photo-storyboard-generation.ts` (~`:700-715`) change `quality: "auto"` to `quality: "high"`. Do NOT use `auto` (Flare `auto` costs $0.25, about double). Keep the other inputs (`aspect_ratio: "3:2"`, `output_format`, `number_of_images`, `background`, `moderation`, `input_images`) only if the Flare schema accepts them (already checked for the photo tier in #400; re-confirm with one live storyboard call). Re-check the `MAX_INPUT_IMAGES = 8` comment at `:75` against Flare's `input_images` limit and fix the comment/value if needed.
- Credits stay unchanged. Keep the pricing keys `storyboard_gpt_image_2_{low,medium,auto}_per_image` and `getStoryboardImageCredits()` as they are (renaming would orphan admin overrides, same rule as #400); `auto` stays the default key, which now corresponds to Flare `high` ($0.128). Update only the cost-source comments (`lib/pricing-defaults.ts:121`, migration 009 note, `docs/billing/pricing-config-v2-plan.md:103-107`, `:395`, `:429`) to say the source is the Flare page and the default sheet runs at Flare `high`. `low`/`medium` keys are not used by the storyboard route today; leave them.
- User-visible labels: `lib/creation-model-label.ts:25` ("GPT Image 2" -> "GPT Image 2.5 Flare") and `lib/admin-pipeline-config.ts:73` description. Existing creations keep their stored `modelLabel`.
- Other leftovers to update (comments/labels only): `app/(app)/tools/canvas/node-data.ts:42` comment, `lib/admin-config-persistence-self-check.ts` / `lib/admin-config-tree-self-check.ts` / `lib/product-photo-gpt-image-self-check.ts` only if they assert anything about the old model (they currently reference the photo tier id `gpt_image_2`, role `image_gpt_image_2` and pricing keys, which MUST NOT be renamed).
- `openspec/changes/storyboard-tab/*` (proposal, design, tasks, spec) mention `openai/gpt-image-2` as the original proposal. Leave as historical, or add a one-line "superseded by Flare" note; do not rewrite.
- Production data: migration 007 seeded `model_configs(storyboard, image) = openai/gpt-image-2` with `on conflict do nothing`, and the resolver prefers a DB row over the code fallback, so changing code alone will NOT move prod. Add an additive, idempotent migration `113_retire_gpt_image_2_model_config.sql`:
  `update model_configs set model = 'openai/gpt-image-2.5-flare' where model = 'openai/gpt-image-2';` (covers the untouched seed and any admin-saved row on the old slug; no-op once applied; do not edit migrations 007/110, they stay immutable). Register it wherever `lib/migration-catalog-self-check.ts` requires. Before merging, run `select tool_key, config_key, model, parameters, updated_by_profile_id from model_configs where model like 'openai/gpt-image-2%';` on prod and confirm no row holds non-empty `parameters` that conflicts with Flare. Also confirm `photo.image_gpt_image_2` has no saved old-model row (#400 note).
- Guard: extend `lib/ai-provider-guard-self-check.ts` (already in `ci:checks`, already scans `app`, `lib`, `scripts`) with a second scan that fails if the exact slug `openai/gpt-image-2` not followed by `.`, `-` or a word character reappears in app/lib/scripts code (exclude the self-check file itself and `supabase/migrations`). Sanity check by temporarily reintroducing the string.
- Preserve: billing contract (spend before provider call, 402, refund, idempotency keys), Replicate as the only provider for storyboard (stays on the `ai-provider-guard` allowlist; not part of the provider seam), pricing keys, tier ids, roles.

## Cost equivalence (Ryan to confirm)

Billing settings (migration 009 seed): 18,000 IDR/USD, 200 IDR/credit, margin 1.0 -> 90 credits per USD; credits = `ceil(provider_cost_usd x 90)` (runtime uses the row's `credit_amount` first, seeded 12).

| | Model / quality | Provider cost (USD/image) | Credits charged |
|---|---|---|---|
| Today | `openai/gpt-image-2`, `quality: "auto"`, pricing key `storyboard_gpt_image_2_auto_per_image` | 0.128 (recorded in `lib/pricing-defaults.ts:124`, `lib/admin-config-defaults.ts:374`, migration 009) | 12 (0.128 x 90 = 11.52, rounded up) |
| Proposed | `openai/gpt-image-2.5-flare`, `quality: "high"` | 0.128 | 12 (unchanged) |
| Rejected | Flare `auto` / `xhigh` | 0.25 | 23 (0.25 x 90 = 22.5, rounded up) |
| Rejected | Flare `medium` | 0.047 | 5 |

Equivalent against the repo's own pricing records: the code already prices old `auto` at the `high` figure, so Flare `high` matches cost and credits exactly. Caveat to confirm: the repo never recorded Replicate's actual price for gpt-image-2 `auto` (only that it is billed as 0.128). If real old `auto` spend differed from 0.128, the margin figure was already off; the user price stays 12 either way. Flare `high` may also render slightly different (higher-effort) sheets than old `auto`; judge with one live sample.

## Technical Notes (verified in repo)

- All remaining `openai/gpt-image-2` / `GPT_IMAGE_2_MODEL` code references: `lib/product-photo.ts:102`, `lib/model-resolver.ts:4,147`, `lib/admin-config-defaults.ts:9,454`, plus seed `supabase/migrations/007_admin_panel.sql:214` (immutable) and comments/docs above. Photo tier already uses `GPT_IMAGE_2_5_FLARE_MODEL` (`lib/product-photo.ts:380`).
- Storyboard credits: `getStoryboardImageCredits()` in `lib/pricing-resolver.ts:337` (default `auto` key); the photo-v2 page shows the same key (`app/(app)/tools/photo-v2/page.tsx:233`).
- UNVERIFIED: Flare accepting `quality: "high"` with `aspect_ratio: "3:2"` plus `input_images` for the storyboard call; confirm with one live call.
- Implement AFTER #394 (phase 2) merges: that phase touches `lib/product-photo.ts` and the photo generation path. Independent of the fal phases 3-7 (#395-#399); no change to them is required.

## Acceptance Criteria

- `git grep -n 'openai/gpt-image-2\b'` outside `supabase/migrations/`, `openspec/` and `.scratch/` returns nothing but the guard's own pattern; `GPT_IMAGE_2_MODEL` no longer exists.
- Storyboard generation calls `openai/gpt-image-2.5-flare` with `quality: "high"`; charged credits remain 12 (402 and refund behavior unchanged).
- Migration `113` applied twice is a no-op the second time; prod `model_configs` has no row on the old slug afterwards; the admin reset for `storyboard.image` returns Flare.
- Guard self-check fails when the old slug is reintroduced; `npm run ci:checks`, `test:ai-provider-guard`, `test:product-photo-gpt-image`, `test:admin-config-persistence`, `test:admin-config-tree`, `test:migration-catalog`, lint and build pass.
- One live storyboard generation succeeds (with and without references). All UI copy in English.

## Comments
