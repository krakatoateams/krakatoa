# Move the photo GPT Image option to GPT Image 2.5 Flare (same price, more shapes)

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/400
Blocked by: none

## Overview

The GPT Image option in the photo tools moves to a newer, wider-ranging version of the same model. People will see a few more picture shapes to choose from, and the price they pay for Low, Medium and High stays exactly the same. Nothing else about the photo tools changes.

## Implementation Requirements

- Swap the Photo tier `gpt_image_2` from `openai/gpt-image-2` to `openai/gpt-image-2.5-flare` on Replicate. Keep the tier id `gpt_image_2`, role `image_gpt_image_2` and the three pricing keys `product_photo_gpt_image_2_{low,medium,high}_per_image` unchanged (ids are persisted in creations and URLs; renaming would orphan admin overrides). Update only the user-visible label (e.g. "GPT Image 2.5 Flare") and the model id.
- Introduce a separate constant for the new model (e.g. `GPT_IMAGE_2_5_FLARE_MODEL`) and use it ONLY for the Photo tier. `GPT_IMAGE_2_MODEL` is also the fallback for `storyboard.image` (`lib/model-resolver.ts:147`, `lib/admin-config-defaults.ts:454`, migration 007 seed) and the storyboard sends `quality: "auto"` which has a different, higher price on Flare (see Technical Notes). Storyboard stays on `openai/gpt-image-2` in this issue (superseded later: issue 08 / #403 moves storyboard to Flare and retires `GPT_IMAGE_2_MODEL`).
- Widen `supportedAspectRatios` for the tier to what Flare accepts: 1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16 (plus `auto` is NOT exposed in the picker). Keep 4:5 and 21:9 clamping via `ASPECT_FALLBACK` to the nearest supported ratio. Verify the real Flare input schema on Replicate before coding (see Technical Notes: unverified).
- Keep v1 quality at `low | medium | high` only. `xhigh` and `max` are a separate later issue (needs new pricing keys and a quality-picker change).
- Keep the billing contract untouched: spend before provider call, 402, refund best-effort, stable idempotency keys.
- Update self-checks: `lib/product-photo-gpt-image-self-check.ts` (model id, expected provider input incl. any removed/renamed fields, aspect-ratio list), `lib/admin-config-persistence-self-check.ts:39-40` (reset default model), and `lib/admin-config-tree-self-check.ts:107` if labels change.
- Before merging, check production `model_configs` for an existing `photo.image_gpt_image_2` row. There is no seed migration for it (the tier falls back to code in `getPhotoModel`), so an admin-saved row would keep the old model; if present, reset it via the admin reset.

## Credit price (needs Ryan's confirmation)

Billing settings seed (migration 009): 18,000 IDR per USD, 200 IDR per credit, margin 1.0 → 90 credits per USD. The existing credits equal `ceil(provider_cost_usd × 90)`:

| Quality | Old credit | Old cost (USD) | Arithmetic | New cost (USD, Flare, Replicate) | New credit |
|---|---|---|---|---|---|
| Low | 2 | 0.012 | 0.012 × 90 = 1.08 → 2 | 0.012 | 2 |
| Medium | 5 | 0.047 | 0.047 × 90 = 4.23 → 5 | 0.047 | 5 |
| High | 12 | 0.128 | 0.128 × 90 = 11.52 → 12 | 0.128 | 12 |

The Flare provider costs given for this task are identical to gpt-image-2, so preserving the credit/cost ratio yields UNCHANGED credits (2 / 5 / 12). No migration or default change is needed for the photo keys, only the cost-source comments (`lib/pricing-defaults.ts:153-157`, migration 110 note) should say the source is now the Flare page. Later-issue costs (not priced here): auto 0.25, xhigh 0.25, max 0.50.

## Technical Notes (verified in repo)

- `lib/product-photo.ts:102` `GPT_IMAGE_2_MODEL`; tier at `:372-392`; `buildPhotoProviderInput` gpt_image case at `:860-871` sends `aspect_ratio, quality, output_format, number_of_images, background, moderation, input_images`.
- Shared constant users: `lib/model-resolver.ts:4,147`, `lib/admin-config-defaults.ts:9,454`, `lib/photo-storyboard-generation.ts:700-715` (sends `quality: "auto"`, `moderation`, `input_images`).
- Runtime credits: `imageCreditsFromRow` in `lib/pricing-math.ts` uses `credit_amount` first (Option A), then provider cost. Migration 110's comment saying credits come from provider cost is out of date.
- Pricing seeds: migration 110, `lib/pricing-defaults.ts:153-157`, `lib/admin-config-defaults.ts:429-440`.
- UNVERIFIED: Flare's Replicate input schema (field names such as `input_images`, `number_of_images`, `moderation`, `background`, `quality` values) and its aspect-ratio list as given by the owner. Confirm on https://replicate.com/openai/gpt-image-2.5-flare and with one live call before merging; drop any field Flare rejects.

## Acceptance Criteria

- Photo GPT tier calls `openai/gpt-image-2.5-flare`; storyboard still calls `openai/gpt-image-2`.
- Picker offers the widened ratios; 4:5 / 21:9 still clamp.
- Credits for Low/Medium/High remain 2/5/12; 402 and refund behavior unchanged.
- One live generation per quality (with and without reference) succeeds on Replicate.
- `npm run ci:checks`, `npm run test:product-photo-gpt-image`, `npm run test:admin-config-persistence`, `npm run test:admin-config-tree`, lint and build pass. Default provider stays Replicate. Rollback: revert the constant (or reset the admin config row).
- All UI copy in English.

## Comments
