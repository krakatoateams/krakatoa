# Adding a generation model (agent runbook)

Written for an AI agent. A human says "add model X to Product Photo" (or Video) and you take it from the
provider's schema to a model users can pick. Work in this order and stop at every **STOP**. Every file,
function, script and table named here exists; if one is missing, the code changed, so re-check this
runbook against the code before going on.

A model goes live in two steps:

1. A developer (you) ships it in code, **switched off** (ship dark).
2. After deploy, the owner applies the pricing migration and turns the model **On** in Admin → **Models**
   (pick the tool at the top).

Step 2 needs no code release.

Why a model cannot be added from the UI by slug: a model only runs if code knows how to call it
(provider adapter, input mapping, output normalizer, trusted output host, pricing keys, label). A free-text
slug would be offered but could not run or be billed. The admin list is built from the code catalog
(`defaultModelCatalogRows()` in `lib/model-catalog-configs.ts`); only models that exist there can be offered.

## Prompt template (for the human)

```text
Add model <provider slug, e.g. bytedance/seedream-5 or fal-ai/flux-2> from <Replicate | fal.ai>
to <Product Photo | Video (text to video / image to video) | Motion Control>.
Follow docs/admin/adding-a-generation-model.md exactly. Ship it dark, give me the price table and the
SQL to apply, and stop before anything that costs money.
Skills that should use it: <none | skill names>. Make it the default anywhere: <no | where>.
```

## 0. Ask the human first (do not guess)

- Which tool: Product Photo (tool key `photo`), Video (`reels`), or Motion Control (also `reels`)?
- Which provider and exact slug or endpoint?
- Should any skill use it, or should it become a default anywhere? Default answer: no.
- Confirm the credit price table (step 2) before you write the migration.

## STOP conditions

Stop and report to the human, without writing code, when any of these is true:

- **Fal for anything other than a Photo tier.** Fal runs only Photo tiers today. Video, motion control and
  reels on Fal need a Fal webhook and a submission fence first (backlog in
  `docs/generation/fal-provider-runbook.md`).
- **A Fal-only photo model with no Replicate twin, without the `falOnly` marker.** `getPhotoModel`
  (`lib/model-resolver.ts`) falls back to Replicate with the tier's `providerModel` whenever the Fal row is
  missing, unsupported, or `FAL_KEY` is absent, so an unmarked tier would call Replicate with a Fal id.
  Resolved in #467: mark the tier `falOnly: true` and follow "Fal-only model" in step 3; never ship one
  without the marker.
- **The schema needs a new input dimension in the UI**, such as a new picker (GPT Image's `quality` was
  one). The pickers live in `app/(app)/tools/photo-v2/page.tsx`, `app/(app)/tools/canvas/nodes/ImageNode.tsx`
  and `app/(app)/tools/skills/SkillComposer.tsx`. Scope that work with the human first.
- **The price depends on something we cannot fix per call.** Examples: billed by tokens, by input
  length, by number of reference images, or by megapixels when we do not fix the size. Megapixel pricing
  is fine when the mapper pins every size: Krea 2 Turbo pins each ratio to at most 1 MP
  (`FAL_KREA_SIZES`) and prices the key at the 1 MP cost. Pricing keys are
  one flat price per image, per second or per run. Fal's GPT Image is token-billed and is priced as an
  approximation (see "Cost approximation" in the Fal runbook); agree on that with the human.
- **The output is not one media URL** (several files, base64, JSON with no URL, or a host other than
  `replicate.delivery` / `*.fal.media`).
- **You would need a live paid call to learn something.** Never run one yourself. Ask the human.
- **You would need a secret.** Never read, print or paste `REPLICATE_API_TOKEN`, `FAL_KEY` or anything from
  `.env.local`. The public pages below need no key.

## 1. Find the real schema (read only, no key)

**Replicate** (`owner/name`):

- `https://replicate.com/<owner>/<name>/llms.txt`: input field names with types, required flags and the
  output schema. Example outputs there are real predictions.
- `https://replicate.com/<owner>/<name>/api/schema`: the full OpenAPI. Read the enum values here
  (aspect ratios, resolutions, formats); `llms.txt` does not list them.
- With a token, `GET https://api.replicate.com/v1/models/<owner>/<name>` returns the same schema under
  `latest_version.openapi_schema`. Without a token it answers 401, so use the public pages.

**fal.ai** (endpoint id such as `fal-ai/nano-banana`):

- `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint id>`: public OpenAPI. The input is
  `components.schemas.<Name>Input` and the output is `<Name>Output`.
- Fal splits text-to-image and edit into separate endpoints (`…/edit`). Read both: the edit endpoint takes
  `image_urls`.
- Example URLs inside the schema (for example `storage.googleapis.com`) are samples. Real outputs come
  from `*.fal.media` (observed live 2026-10-31).

Map every provider field onto our standard fields and write the table into your PR:

| Our field | Photo today | Video today |
|---|---|---|
| Prompt | `prompt` | `prompt` |
| Reference images | `referenceParam`: `image_input` (array), `input_image` (one), `input_images` (array); Fal `image_urls` | first and last frame plus reference slots, declared in `references` (`VideoReferenceCaps`) |
| Aspect ratio | `aspect_ratio`, limited by `supportedAspectRatios` (`clampAspectRatioForTier`) | `aspectRatios` |
| Resolution | `resolutions` (1k/2k/4k; sent as `resolution` "1K"/"2K"/"4K"), or `hasResolution: false` with `fixedResolutionLabel` | `resolutions` |
| Count | one provider call per image (`number_of_images: 1` where the model has a count field) | one clip per call |
| Duration | none | `durations`, `defaultDuration` |
| Output | one URL string, file output or array (`extractMediaUrl` in `lib/replicate-server.ts`); Fal `{ images: [{ url }] }` (`normalizeFalOutput`) | one URL (`extractMediaUrl`) |

List every provider field you did not map, with its default, and say why leaving it at the default is
safe. Unmapped fields that change price or output size (count, size, quality, duration, audio) must be
mapped or pinned explicitly. If one cannot be, **STOP**.

## 2. Price it (same method as every existing model)

**The formula** (`calculateCredits` in `lib/pricing-math.ts`):

```text
credits per unit = ceil(provider_cost_usd × usd_to_idr × margin_multiplier ÷ credit_value_idr)
```

- The unit is one image, one second of video, or one run.
- The settings come from the `billing_settings` row `key = 'global'`, read by `getBillingSettings()`.
  Live on 2026-11-01: `usd_to_idr = 18000`, `credit_value_idr = 200`, `margin_multiplier = 1.0`, so
  **credits = ceil(cost × 90)**.
- One credit earns `credit_value_idr ÷ usd_to_idr` = **$0.0111**.
- With the multiplier at 1.0, the only margin is the rounding up, worth 0 to 1 credit per unit.
- Do not change `billing_settings`: it reprices every model. If the human wants more margin on this
  model, they say so and you set a higher `credit_amount` (step 4).

**Which cost:** the provider's published price for exactly the input we send (the resolution, quality or
audio variant). One pricing key per price variant: per image, per second (video) or per run.

- Replicate's price is on the model page: the page JSON has `"price": "$0.039"` with a `metric` such as
  `image_output_count`.
- Fal's price is on `https://fal.ai/models/<endpoint id>` ("Each image costs $0.0398").
- Fal's pricing API (`api.fal.ai/v1/models/pricing`) needs a key, so do not use it.
- If the tier can run on more than one provider, price it from the **highest** of their costs, so no
  provider loses money. Store that cost as the key's `provider_cost_usd`.

**What users pay:** at runtime the stored integer `credit_amount` wins over the cost
(`imageCreditsFromRow` / `videoCreditsFromRow`, "Option A"). The total is:

- images: count × `credit_amount`;
- video: duration in seconds × `credit_amount`, with a minimum of 1 credit.

So the migration's `credit_amount` IS the price. Compute it with the formula, then write it down.

**Worked examples.** These are existing models; the live column was checked on 2026-11-01 through
`GET /api/credits/pricing`.

| Model, variant | Cost (USD) | × 90 | Credits | Live |
|---|---|---|---|---|
| GPT Image 2.5 Flare, medium (per image) | 0.047 | 4.23 | 5 | 5 |
| Nano Banana (basic, per image) | 0.039 | 3.51 | 4 | 4 |
| Nano Banana Pro, 4K (per image) | 0.30 | 27.000…004 | 27 (float noise ignored, `CEIL_EPSILON`) | 27 |
| Grok Imagine Video, 720p (per second) | 0.08 | 7.2 | 8, so a 10 s clip costs 80 | 8 |

**Reference snapshot** (a sample, not the full list; the console snippet below lists all keys).
Re-verify before you rely on it: an admin can edit prices. The Nano Banana 2 row shows the prices after
`120_raise_nano_banana_2_1k_price.sql` (#464, 1K) and `121_raise_nano_banana_2_2k_4k_price.sql` (#469, 2K
and 4K); before those run they are 0.067 / 7, 0.101 / 10 and 0.151 / 14.

| Pricing key | Cost (USD) | Credits |
|---|---|---|
| `product_photo_nano_banana_per_image` | 0.039 | 4 |
| `product_photo_nano_banana_2_1k_per_image` / `_2k_` / `_4k_` | 0.08 / 0.12 / 0.16 | 8 / 11 / 15 |
| `product_photo_nano_banana_pro_1k_per_image` / `_2k_` / `_4k_` | 0.15 / 0.15 / 0.30 | 14 / 14 / 27 |
| `product_photo_gpt_image_2_low_per_image` / `_medium_` / `_high_` | 0.012 / 0.047 / 0.128 | 2 / 5 / 12 |
| `product_photo_krea_2_turbo_per_image` (fal only, after `122_krea_2_turbo_pricing.sql`) | 0.008 | 1 |
| `product_photo_krea_2_large_per_image` / `_medium_` (Replicate or fal, after `123_krea_2_large_medium_pricing.sql`) | 0.06 / 0.03 | 6 / 3 |
| `grok_imagine_480p_per_second` / `grok_imagine_720p_per_second` | 0.05 / 0.08 | 5 / 8 |
| `kling3_pro_per_second` | 0.224 | 21 |

Live on 2026-11-01:

- 66 of the 74 prices returned by `/api/credits/pricing` equal ceil(cost × 90).
- The 8 that differ are older Kling prices set about 5 to 11 % higher, for example
  `kling3omni_pro_per_second` costs 0.224 but charges 22 instead of 21. The others are
  `kling15_pro_per_second`, `kling16_pro_per_second`, `kling26_with_audio_per_second` and the other
  `kling3omni_*` keys.
- Do not copy them: price new models with the formula.

To re-check live prices, sign in to the app as any user and run this in the browser console. It is read
only.

```js
const d = await fetch('/api/credits/pricing').then(r => r.json());
d.configs.map(c => [c.pricingKey, c.providerCostUsd, c.creditAmount]);
```

**Provider cost per provider** goes in `provider_model_costs`: one row per (provider, model, pricing key).
It is for margin and analytics only, and billing never reads it. The admin margin is
`marginForCost(credits, costUsd, settings)` in `lib/admin-provider-switch.ts`:

```text
revenue = credits × credit_value_idr ÷ usd_to_idr
margin  = revenue − cost
```

**Check the margin on every provider the tier can run on.** The price is one per key, but the cost
differs per provider. Example: `product_photo_nano_banana_2_1k_per_image` used to charge 7 credits
($0.0778): Replicate costs $0.067, but Fal costs $0.08, so every Fal image lost $0.002. Since #464
(`120_raise_nano_banana_2_1k_price.sql`) it is priced from the Fal cost: ceil(0.08 × 90) = 8 credits
($0.0889). `_2k_` and `_4k_` followed in #469 (`121_raise_nano_banana_2_2k_4k_price.sql`): ceil(0.12 × 90) =
11 and ceil(0.16 × 90) = 15 credits, so no Nano Banana 2 size loses money on Fal any more. Show the human
the margin per provider and let them choose the price.

In Admin → Models, a row's price table shows this directly (display only, #466):

- **Highest cost $** is the key's `provider_cost_usd`, and the **→ N** button suggests credits from it.
- **Margin per provider** lists each provider's cost from `provider_model_costs` and its margin. If
  Replicate has no row there, its margin uses the highest cost. A Fal tier without a row shows "cost not set".

## 3. Code (ship dark)

Copy the closest existing entry of the same provider family; do not invent a new pattern.

**Every model:**

1. **Registry entry.** Pick the registry for the tool:
   - Photo: add the id to `ProductPhotoModelTier` and an entry to `PRODUCT_PHOTO_TIERS`
     (`lib/product-photo.ts`). Set `id`, `label`, `subtitle`, `modelLabel`, `modelRole` (the
     `model_configs` config key, `image_<id>`), `providerModel` (the Replicate slug), the
     resolution/quality fields, `providerFamily`, `supportsReference`, `referenceParam` and
     `supportedAspectRatios`.
   - Video: add the id to the `VideoModelId` union, an entry to `VIDEO_MODEL_REGISTRY` and the id to
     `VIDEO_MODEL_SORT_ORDER` (`lib/video-models.ts`). `VIDEO_MODELS` is built from the sort order.
   - Motion Control: `MOTION_CONTROL_MODEL_REGISTRY` and `MOTION_CONTROL_SORT_ORDER`
     (`lib/motion-control-models.ts`).

   Never reuse a retired id, slug or pricing key. Never remove an entry later.
2. **`offeredByDefault: false`.** Required on every new entry; `test:model-catalog-guard` fails without
   it. The model then appears in its tool's list in Admin → Models, switched Off. Never add to
   `OFFERED_BEFORE_SHIP_DARK` (`lib/model-catalog-configs.ts`, frozen).
3. **Input mapping.** If an existing family sends exactly the fields the schema needs, reuse it. Otherwise
   add a family and its case:
   - Photo: `PhotoProviderFamily` plus a case in `buildPhotoProviderInput`.
   - Video: `VideoProviderFamily` plus a case in `buildVideoProviderInput`.

   Send only fields the schema has. Pin anything that changes price or size.
4. **Pricing keys.**
   - Photo: the keys sit on the tier (`basicPricingKey`, or `pricingKey` per resolution or quality) with a
     `fallbackCredits` / `basicFallbackCredits` equal to the step 2 credits. That value is a UI safety net
     only.
   - Video: add a `<model>PricingKey()` function to `lib/pricing-math.ts` (pattern
     `grokImagineVideoPricingKey`) and point the entry's `pricingKey` at it.
   - Motion Control: same, keyed by mode (pattern `klingV3MotionControlPricingKey`).
   - Add every key to `V2_PRICING_DEFAULTS` (`lib/pricing-defaults.ts`) with the provider cost.
   - `modelPricingKeys()` (`lib/model-pricing-keys.ts`) derives the keys from the entry. If you add a new
     billing path that it does not see, extend it: `test:model-catalog-guard` fails on an uncovered key.
5. **Eligibility** is code only:
   - Photo: `eligibleTiersForFeature` in `lib/creation-features.ts` (reference features need
     `supportsReference`).
   - Video: `modelEligibleForComposer` in `lib/video-composer-features.ts` (from `subtools` and
     `references`).

   A missing `feature_model_configs` row means enabled, so the model shows in every eligible feature
   once it is On.
6. **Defaults and skills.** Leave them unchanged unless the human asked:
   - `DEFAULT_PRODUCT_PHOTO_TIER`, `defaultTierForFeature`, `DEFAULT_VIDEO_MODEL_ID`,
     `defaultModelForComposer`;
   - a skill's `modelId` in `lib/skills.ts`.
7. **History label.** `lib/creation-model-label.ts` reads `modelLabel` and `providerModel` from the
   registry, so set them correctly.

**Replicate, extra:** nothing else. Replicate runs any slug (`PROVIDER_CATALOG` has
`{ provider: "replicate", model: "*" }`). The resolver falls back to the entry's `providerModel`, so no
`model_configs` row is needed.

**Fal (Photo tier that also runs on Replicate), extra:**

1. Add an entry to `FAL_PHOTO_MODELS` in `lib/ai-providers/fal-photo-catalog.ts`. Key it by the
   text-to-image endpoint id, with `configKey` set to the tier's `modelRole`, plus `editEndpoint`,
   `family` and `hasResolution`. `PROVIDER_CATALOG` (`lib/ai-provider-catalog.ts`) picks it up, scoped to
   that tier.
2. If the fields differ from `nano` / `gpt_image_flare`, widen the `family` union on `FalPhotoModel` and
   add a branch to `mapFalPhotoInput`. The input it maps is the Replicate-shaped one from
   `buildPhotoProviderInput` (the nano branch reads only `image_input`). It is an allowlist:
   Replicate-only fields must never leak.
3. Output must be `{ images: [{ url }] }` on `*.fal.media`. `normalizeFalOutput` enforces both through
   `assertTrustedFalOutputUrl`; never widen the host check.
4. Extend `lib/ai-providers/fal-photo-self-check.ts` with the new mapping.
5. Read the Fal sections of `docs/generation/fal-provider-runbook.md` before you start: switching,
   cancel, refunds, reconcile, cost approximation.
6. A text-to-image-only model on both providers (pattern: Krea 2 Large / Medium, #474) uses a Fal entry
   with no `editEndpoint` (the `krea_v2` family), its own Replicate `providerFamily`, and the tier's
   `supportedAspectRatios` + `limitAspectRatioPicker` when the provider takes an aspect-ratio enum. Set
   `rejectsReference: true` so the route refuses a reference with a 400 before the spend, and
   `maxPromptChars` when the provider caps the prompt.

**Fal-only model (Photo tier with no Replicate equivalent, #467), extra:**

1. Everything in the Fal list above. The `FAL_PHOTO_MODELS` entry may be text-to-image only (no
   `editEndpoint`; pattern: the `krea_t2i` family). Set the tier's `providerModel` to the Fal endpoint id
   and `supportsReference: false` unless the Fal model takes references.
2. Mark the tier `falOnly: true`. That marker is what makes it safe:
   - `getPhotoModel` sends it to `resolveFalOnlyPhotoModel` (`lib/fal-only-photo-model.ts`), which **never
     falls back to Replicate**. A missing or disabled Fal row, an off-catalog model, a missing `FAL_KEY`
     or a failed model-state read throws `ModelStateUnavailableError`, and the route answers the retryable
     503 before any spend or provider call. Every other tier keeps the Replicate fallback.
   - Admin → Models shows "Provider: fal.ai only", with a warning when `FAL_KEY` or the row is missing.
     The provider dropdown, a PATCH and Reset can never move the row to Replicate
     (`isFalOnlyPhotoRole`, `photoPatchUnit`, `getModelDefault`).
   - Turning it On checks `FAL_KEY` (`PROVIDER_NOT_CONFIGURED`), because `activePhotoProvider` is always
     `fal` for it.
3. The mapper must reject reference images (last line of defence). Set `rejectsReference: true` (and
   `maxPromptChars` when the provider caps the prompt) so the generate route refuses them with a 400
   before the spend; other text-only tiers keep ignoring references.
4. The migration (step 4) must also insert the tier's `model_configs` row (`provider 'fal'`, the endpoint
   id, `on conflict (tool_key, config_key) do nothing`). Until it exists, generations are refused with the
   503; nothing is charged. Pattern: `122_krea_2_turbo_pricing.sql`.
5. Self-checks: `lib/fal-only-photo-model-self-check.ts` (resolver cases and wiring pins) and the Fal-only
   cases in `lib/admin-provider-switch-self-check.ts`.

**Do not touch:**

- spend and refund code or idempotency keys;
- `billing_settings`;
- the fail-closed model state;
- `lib/security-headers.mjs`: outputs are copied to Storage, so no browser allowlist changes.

## 4. Migration (the owner applies it by hand)

Pricing must exist in the database before the model can be turned On. The guard
(`pricingNotReadyKeys` in `lib/model-catalog-guard.ts`) refuses with `PRICING_NOT_READY` until every key
has a `pricing_configs` row that is enabled, not deprecated, and has an integer `credit_amount`.

Write one additive, idempotent file `supabase/migrations/<next number>_<model>_pricing.sql`:

- use the next free number;
- no spaces in the name (`test:migration-catalog`);
- re-running it must change nothing.

The owner applies it in the Supabase SQL editor, or with `npm run db:setup`. Patterns:
`110_gpt_image_2_product_photo_pricing.sql` (photo, per image), `026_seedance15_pro_pricing.sql` (video,
per second), `082_canvas_text_pricing.sql` (per run), `115_fal_nano_banana_provider_costs.sql` (Fal cost
rows).

```sql
-- <NNN>_<model>_pricing.sql
-- <Label> (<provider slug>) for <tool>. Provider price checked <YYYY-MM-DD>: <source URL>.
-- credits = ceil(cost_usd * usd_to_idr * margin_multiplier / credit_value_idr) at the billing_settings
-- you read on <YYYY-MM-DD> (<usd_to_idr> / <credit_value_idr> / <margin_multiplier>).
-- Additive + idempotent (safe to re-run).
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('<pricing_key>', '<Tool> — <Label> <Variant>', 'per_image', <credits>, <cost_usd>, 'per_image', '<group>', '<variant>', 'USD')
  -- video: 'per_second', <credits per second>, <cost per second>, 'per_second'
  -- per run: pricing_type 'fixed' (the column's check allows only fixed / per_second / per_image),
  --          cost_unit 'per_run' (082)
on conflict (pricing_key) do nothing;

-- Margin data only (billing never reads it). One row per provider the tier can run on.
insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('replicate', '<owner/name>', '<pricing_key>', <cost_usd>, 'per_image')
  -- , ('fal', '<fal text-to-image endpoint id>', '<pricing_key>', <fal cost_usd>, 'per_image')
on conflict (provider, model, pricing_key) do nothing;
```

Before the migration is applied, an admin can also create a missing price for a key that is in
`V2_PRICING_DEFAULTS` by saving it in Admin → Models. The route is
`PATCH /api/admin/config/pricing/[pricing_key]`, and `saveBuiltinPricingConfig` inserts from the
built-in default. That default is priced with `DEFAULT_BILLING_SETTINGS` (`lib/pricing-math.ts`), not
the live `billing_settings`; the two match today. The migration stays the record of the price.

## 5. Verify

1. Run the self-checks for what you touched:
   - `npm run test:model-catalog-guard` (ship-dark flag, pricing-key coverage, guard);
   - `npm run test:admin-config-tree`;
   - Fal: `npm run test:ai-provider-guard`;
   - GPT Image style tiers: `npm run test:product-photo-gpt-image`;
   - `npm run test:migration-catalog`.

   Then run `npm run lint` and `npm run ci:checks`, which also builds.
2. Admin → Models locally (or on a preview), with its tool picked: the model is in the list, switched
   **Off**, with its price under the row's arrow.
3. Write the PR body. Include the mapping table, unmapped fields, the price table with sources and dates,
   the margin per provider, the SQL file, and what the owner must do.
4. **Test generation (the owner runs it; it costs money).** There is no per-model preview: turning a model
   On offers it to every user on their next request. Do it in this order:
   1. On the provider's own playground (replicate.com or fal.ai, the owner's account): one run with a
      typical prompt and reference, to judge quality and output shape. Cost: about the provider price.
   2. After deploy and the migration: turn it On (step 6), and right away generate one image or the
      shortest clip as an admin. Cost: the credits from step 2 plus the provider price.
   3. Check:
      - credits were spent once (`credit_transactions`);
      - the file is in the library and Storage;
      - the history shows the right model label;
      - `generation_predictions.provider` is the expected provider.
   4. If anything is wrong, switch it **Off** at once (effective on the next request) and report.

   Never announce the model or make it a default before this run passes.

## 6. Turn it on (Admin → Models)

1. Open the **Models** tab and pick the tool at the top (Product Photo or Video). Each row shows the
   name, its price (read-only, for example "10 credits per image"), an **On/Off** switch and **Remove**.
   Provider, modes, defaults and the price table open with the row's arrow. The new model is in the
   list, switched Off. (The **Config** tab only holds each tool's On / Sidebar / Coming soon.)
2. Turn it **On**. The switch goes through `PATCH /api/admin/config/model-catalog/[id]`
   (`checkModelCatalogChange()`, compare-and-set, audit). The first offer of a ship-dark model is audited
   as `model_add`, later ones as `model_enable`.
3. A refusal is one sentence next to the row:
   - `PRICING_NOT_READY`: apply the migration;
   - `PROVIDER_NOT_CONFIGURED`: the provider's server key is missing.

   This flow never writes pricing or billing.
4. Fal tier: the model starts on Replicate (a Fal-only tier is always on fal.ai). To move it to Fal, use the tier's provider dropdown; see
   "Switch a tier to Fal" in the Fal runbook.

## Removing a model, and adding it back

**Remove** (in the model's row) takes the model out of **that tool only**:

- It archives the tool's `model_catalog_configs` row (migration 118, `POST …/[id]/archive`).
- The model leaves the tool's list at once, and users stop seeing it on their next request.
- Past creations keep their label, and prices are kept.
- The confirmation names the features that lose it, the Reels engine it runs, the skills that use it,
  jobs still running and how often it was used.
- The server refuses, and the dialog says why in one sentence, while the model is:
  - the default of a feature (`IS_DEFAULT`: pick another default in the row's details first);
  - the last model of the tool (`LAST_ENABLED_MODEL`);
  - the last Reels engine (`REELS_ENGINE_LAST`).
- Catalog rows are per tool, so a model is never shared between tools.

**Restore model** (one button per tool in the Models tab, formerly "Add model") lists only that tool's removed models:

- Choosing one restores it (`POST …/[id]/restore`) and turns it on (`PATCH …/[id]`), re-running the price
  and provider guard.
- A model that cannot be offered yet is listed with the reason and cannot be picked.
- **Restore model never shows a brand-new model.** A new model needs the code and pricing above. It then
  appears in its tool's list switched Off, and turning it On is how it is added.

## Retiring a model

Full runbook: [`retiring-a-generation-model.md`](retiring-a-generation-model.md). In short:

1. Remove it in Admin → Models first.
2. Change code only after no jobs are in flight and the 72 h reconcile window has passed.
3. Keep the registry entry (set `offeredByDefault: false`); never delete its rows or its pricing (deprecate
   pricing, pattern `040_deprecate_kling20.sql`). Deleting the entry is an owner-decided exception that needs a
   retired-label map and a history check first ("Deleting a registry entry", example #476).
4. Never reuse its id, slug or pricing key.

## When the model settings cannot be read (fail closed)

An archived or admin-disabled model must never be usable. If reading `model_catalog_configs` or
`feature_model_configs` fails (database error, timeout, network), the app does not fall back to the code
defaults:

- the model lists return a retryable 503;
- every generate route answers 503 before any spend or provider call.

Only a table that does not exist at all (migration never applied) uses the code defaults. Check with
`npm run test:model-catalog-guard`.

## Final checklist

- [ ] Asked the human: tool, provider and slug, skills, defaults; price confirmed.
- [ ] Schema read from the public pages; mapping table plus unmapped fields in the PR; no STOP condition hit.
- [ ] Price per key = ceil(cost × 90) at current `billing_settings` (or the human's higher price), with
      sources and dates; margin shown per provider.
- [ ] Registry entry with `offeredByDefault: false`; input mapping; pricing keys in the entry and
      `V2_PRICING_DEFAULTS`; Fal catalog entry if Fal.
- [ ] Idempotent migration with `pricing_configs` and `provider_model_costs`; the owner told to apply it.
- [ ] Self-checks, `npm run lint` and `npm run ci:checks` green; the model shows Off in its card.
- [ ] No change to billing, refunds, fail-closed state, host allowlists, defaults (unless asked) or secrets.
- [ ] After deploy: migration applied, model turned On, one test generation passed (or switched Off and
      reported).
