# Pricing Config v2 — Provider-Cost-Based Pricing

> Status: APPROVED PLAN (documentation only). Nothing in this document has been
> implemented yet. No migration, schema change, resolver change, route change,
> admin/UI change, or payment work has been performed. This file captures the
> agreed design so the team can review before any implementation step.

---

## 1. Purpose

Pricing Config v2 moves Krakatoa from **coarse integer credit pricing** to
**provider-cost-based pricing**.

Today, `pricing_configs` stores a single integer `credit_amount` per key (for
example `product_photo`, `storyboard_image`, `seedance_video_per_second`,
`veo_video_per_second`). That is too coarse if we want the credit charge to track
the real provider USD cost per model / resolution / quality.

The goal of v2 is **accurate internal-testing pricing**: the credit charge should
match the underlying provider cost as closely as possible (currently 1:1, no
margin), computed from the provider's USD price rather than a hand-tuned integer.

This is for internal testing. It is **not** a payment, top-up, subscription, or
monetization feature — those remain deferred and will be brainstormed separately.

---

## 2. Current internal testing assumptions

- Rp100.000 = 500 credits
- Rp50.000 = 250 credits
- 1 credit = Rp200
- 1 USD = Rp18.000
- `margin_multiplier = 1.0`
- Goal = pure provider cost **1:1**
- No arbitrary safety buffer
- No hidden overhead
- No extra margin yet
- Rounding happens **only at the final charge**

Important principle: we do **not** add credits "just to be safe", we do **not**
add a flat overhead, and we do **not** add margin yet. The only rounding is a
single `ceil` on the final computed credit amount.

---

## 3. Core formula

```
credits = ceil(provider_usd_cost * unit_count * usd_to_idr * margin_multiplier / credit_value_idr)
```

With the current internal-testing settings (`usd_to_idr = 18000`,
`credit_value_idr = 200`, `margin_multiplier = 1.0`), the conversion factor
simplifies to `18000 / 200 = 90`:

```
credits = ceil(provider_usd_cost * unit_count * 90)
```

### Duration rule (critical)

For duration-based tools, calculate the **total USD cost first**, then convert,
then round **once**. Never round per-second first.

Example — Seedance 720p, 15 seconds:

```
0.15 * 15        = 2.25 USD          (total provider cost)
ceil(2.25 * 90)  = ceil(202.5) = 203 credits
```

Do **not** do:

```
ceil(0.15 * 90) * 15 = ceil(13.5) * 15 = 14 * 15 = 210 credits   (WRONG)
```

Rounding per-second first inflates the charge (203 -> 210) by adding unnecessary
rounding overhead on every second. Always round only at the end.

---

## 4. Provider pricing table (initial)

These are the initial provider USD prices used to seed v2 configs. They are
admin-editable later and expected to change as providers adjust pricing.

### Seedance 2.0 Fast
- 480p `non_video_in`: **$0.07 / sec**
- 720p `non_video_in`: **$0.15 / sec**
- `video_in`: **deferred** (current flow is text/image/storyboard input to video,
  not uploaded reference video)

### Veo 3.1 Lite
- 720p: **$0.05 / sec**
- 1080p: **$0.08 / sec**

### GPT Image 2 / Storyboard
- low: **$0.012 / image**
- medium: **$0.047 / image**
- auto / high: **$0.128 / image**

### Product Photo / Nano Banana Pro
- fallback / low: **$0.035 / image**
- 1K: **$0.15 / image**
- 2K: **$0.15 / image**
- 4K: **$0.30 / image**

### Whisper
- about **$0.0033 / run**
- informational only for now (not a separate user-facing charge)

### MiniMax Speech Turbo
- about **$0.06 per 1k input tokens**
- token-based pricing **deferred** (see Phase v2.2)

---

## 5. Worked examples

All at `margin_multiplier = 1.0`, factor `= 90`:

- Storyboard auto: `ceil(0.128 * 90) = ceil(11.52) = 12 credits`
- Seedance 720p 15s: `ceil(0.15 * 15 * 90) = ceil(202.5) = 203 credits`
- Veo 720p 15s: `ceil(0.05 * 15 * 90) = ceil(67.5) = 68 credits`
- Veo 1080p 15s: `ceil(0.08 * 15 * 90) = ceil(108.0) = 108 credits`
- Product Photo 1K: `ceil(0.15 * 90) = ceil(13.5) = 14 credits`
- Product Photo 4K: `ceil(0.30 * 90) = ceil(27.0) = 27 credits`
- Seedance 480p 15s: `ceil(0.07 * 15 * 90) = ceil(94.5) = 95 credits`

---

## 6. Proposed schema plan (future migration 009 — NOT implemented)

Proposed migration file: `supabase/migrations/009_pricing_config_v2.sql`. This is
a **proposal only**; do not create it in the docs step.

### Proposed `billing_settings` table (singleton global knobs)
- `key` = `'global'` (single-row guard via `check (key = 'global')`)
- `usd_to_idr` (numeric, default 18000)
- `credit_value_idr` (numeric, default 200)
- `margin_multiplier` (numeric, default 1.0)
- `rounding_mode` (text, default `'ceil_final'`)
- `updated_by_profile_id`
- `created_at`, `updated_at` (with the shared `krakatoa_set_updated_at` trigger)
- RLS enabled, **no public policies** (service-role only; app enforces access)
- One seeded `global` row

### Proposed `pricing_configs` extensions
- `provider_cost_usd` (numeric, nullable — null means "use legacy path")
- `cost_unit` (text; one of `per_image`, `per_second`, `per_run`, `per_1k_tokens`)
- `pricing_group` (text; e.g. `seedance`, `veo`, `storyboard_image`, `product_photo`)
- `variant_key` (text; e.g. `480p`, `720p`, `1080p`, `auto`, `1k`, `4k`)
- `currency` (text, default `'USD'`)

### Backward compatibility
- Keep the existing `credit_amount` column as the fallback value. Existing rows
  stay in place. v2 rows can also carry a sensible `credit_amount` so the legacy
  resolver path still produces a usable number if provider cost / billing settings
  are unavailable.
- `pricing_type` is retained for backward compatibility; `cost_unit` becomes the
  authoritative unit going forward.

---

## 7. Proposed pricing keys

### New v2 keys
- `seedance_480p_per_second`
- `seedance_720p_per_second`
- `veo_720p_per_second`
- `veo_1080p_per_second`
- `storyboard_gpt_image_2_low_per_image`
- `storyboard_gpt_image_2_medium_per_image`
- `storyboard_gpt_image_2_auto_per_image`
- `product_photo_fallback_per_image`
- `product_photo_1k_per_image`
- `product_photo_2k_per_image`
- `product_photo_4k_per_image`

### Deferred (do not add in v2.1)
- Seedance `video_in` variants
- MiniMax token-based charge (`per_1k_tokens`)
- Whisper separate charge (`per_run`, informational only)
- LLM token charge

### Backward compatibility
- Existing rows kept for fallback: `seedance_video_per_second`,
  `veo_video_per_second`, `storyboard_image`, `storyboard_video`, `product_photo`.

---

## 8. Product Photo quality plan (proposed v1)

User-facing options (UMKM-friendly wording):

- **Standard** -> `product_photo_1k_per_image` (14 credits at current settings)
- **Ultra 4K** -> `product_photo_4k_per_image` (27 credits at current settings)
- optional hidden / internal **Low** -> `product_photo_fallback_per_image`
  (4 credits at current settings)

Notes:
- The `product_photo_2k_per_image` key exists for future use, but **Standard can
  start with 1K** because 1K and 2K currently share the same provider price
  ($0.15/image -> 14 credits), so exposing both adds no price difference today.
- The selected quality determines the pricing key, is sent to the backend, and the
  resolver uses the matching provider cost. The button label reflects the selected
  quality's cost.
- Open item: Product Photo quality must match the **actual provider/model
  parameters** later (e.g. the model id or a size/quality parameter for
  1K/2K/4K). That model wiring is separate from pricing v2 and is flagged for the
  implementation step.

---

## 9. Video resolution pricing plan

Backend selects the pricing key from the request's resolution:

- Seedance 480p -> `seedance_480p_per_second`
- Seedance 720p -> `seedance_720p_per_second`
- Veo 720p -> `veo_720p_per_second`
- Veo 1080p -> `veo_1080p_per_second`

`video_in` variants are **deferred** because the current Krakatoa flow is
text / image / storyboard input to video, **not** uploaded reference video to
video (so all current flows are `non_video_in`).

---

## 10. Resolver plan (future)

- Add a shared, pure module `lib/pricing-math.ts` imported by **both** server and
  client so the formula has a single source of truth (prevents FE/BE drift).
  Core function: `calculateCredits({ providerCostUsd, unitCount, settings })`.
- Add a billing settings reader (e.g. `lib/billing-settings-db.ts`) with safe
  defaults if the row is missing.
- Update `lib/pricing-resolver.ts` to compute credits dynamically from
  `provider_cost_usd` and `unit_count` (duration seconds, image count, or run
  count), e.g. `getVideoCredits({ pricingKey, durationSec })`,
  `getImageCredits({ pricingKey, imageCount })`, `getRunCredits({ pricingKey })`.
- Fallback chain (never throws):
  `v2 provider_cost_usd` -> legacy `credit_amount` -> `lib/credit-costs.ts`
  constants.
- Keep the existing 60s cache (also cache billing settings).
- Avoid per-second rounding — always compute total USD, then a single final
  `ceil`.

---

## 11. Frontend pricing label plan

- `/api/credits/pricing` should return the **billing settings** and the
  **effective provider-cost configs** (per key: provider cost, cost unit, variant,
  group).
- The frontend should compute displayed credits using the **shared pricing math**
  (or use backend-provided computed values) so labels always match backend
  billing within the cache window.
- The Product Photo label updates when the selected **quality** changes.
- Video labels update when **resolution** and **duration** change.
- Avoid frontend/backend mismatch by using the same `lib/pricing-math.ts` formula
  on both sides and keeping the current fallback-constant behavior so labels never
  show NaN/0.

---

## 12. Admin UI plan (future)

- Show the **provider USD cost** per pricing row.
- Show the **cost unit** (`per_image` / `per_second` / `per_run` / `per_1k_tokens`).
- Show a **computed credits preview** using the current billing settings.
- Show the **billing settings**: USD to IDR, credit value IDR, margin multiplier,
  rounding mode.
- Warnings:
  - Internal testing uses `margin_multiplier = 1.0`.
  - Changing USD / credit value / margin affects **all future generation costs**.
  - Rounding happens **only at the final charge**.
- **No** payment / top-up UI.

---

## 13. Implementation phases

### Pricing v2.1
- Schema (billing_settings + pricing_configs extensions)
- Pricing math (shared module)
- Resolver updates (dynamic compute + fallback chain)
- Admin UI (provider cost, cost unit, computed preview, billing settings)
- Frontend labels (shared math)
- Product Photo quality selector
- Generation routes use v2 pricing **with fallback**
- No payment

### Pricing v2.2 (later)
- Token-based MiniMax / LLM / Whisper component costs if needed
- Margin mode for public launch (`margin_multiplier > 1.0`)
- Seedance `video_in` variants if reference-video upload exists

---

## 14. No-provider-call verification policy

When implementation happens (separate, explicitly-approved step), verification is
strictly no-cost:

- `npm run build` and `npm run lint`
- Read-only DB checks (billing_settings exists + single row + RLS, new
  pricing_configs columns, seeded v2 rows)
- Helper-level math examples (pure, no DB/provider), e.g.:
  - `0.128 image -> 12 credits`
  - `0.15/sec * 15s -> 203 credits`
  - `0.05/sec * 15s -> 68 credits`
  - `0.15 image -> 14 credits`
  - `0.30 image -> 27 credits`
- No generation
- No provider calls (Replicate, MiniMax, Whisper, Rendi, Seedance, Veo, GPT Image,
  Nano Banana, etc.)
- No payment calls
- No cron / YouTube

---

## 15. Risks and open questions

- **Floating-point precision**: apply a small epsilon / fixed-decimal rounding
  before the final `ceil` so values like `0.30 * 90 = 27` don't drift to
  `27.0000001 -> 28`. Verify each worked example.
- **Backward compatibility with old `credit_amount`**: missing v2 fields must fall
  back to legacy `credit_amount`, then to `lib/credit-costs.ts` constants; the
  resolver must still never throw.
- **Frontend/backend pricing mismatch**: mitigated by the shared
  `lib/pricing-math.ts`; both sides must read the same billing settings (a brief
  cache-window skew is acceptable, same as today).
- **Product Photo quality not matching provider input**: the selected quality must
  map to the actual provider/model parameters (model id or size/quality param);
  flagged for the implementation step.
- **Future provider price changes**: prices are admin-editable; document a review
  cadence.
- **USD/IDR exchange changes**: `usd_to_idr` is admin-editable; changes affect all
  future generation costs.
- **Margin accidentally left at 1.0 at public launch**: add an admin warning plus
  a pre-launch checklist item to set the intended margin.
- **Admin config complexity**: keep the computed-credits preview to reduce
  configuration mistakes.
- **Integer credits can overcharge by less than 1 credit** due to the final
  `ceil`. Accepted and documented.
- **Real Replicate approximate cost may display rounded values**: displayed/charged
  credits derive from configured provider costs, which are approximations and may
  round.
- **1:1 scope**: "1:1 provider cost" currently means the **dominant media provider
  cost** (video per-second, image per-image), **not** the full literal total cost.
  TTS (MiniMax), Whisper, and LLM sub-calls are currently **not** charged. This is
  an intentional simplification, not literal total-cost parity.
