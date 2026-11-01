-- 122_krea_2_turbo_pricing.sql
-- Krea 2 Turbo (fal-ai/krea-2/turbo) for Product Photo, text-to-image only, Fal-only tier (#467).
-- Provider price checked 2026-11-01: https://fal.ai/models/fal-ai/krea-2/turbo ($0.008 per megapixel).
-- Every aspect ratio is pinned to an image_size of at most 1,000,000 px (FAL_KREA_SIZES), so one image
-- costs at most $0.008.
-- credits = ceil(cost_usd * usd_to_idr * margin_multiplier / credit_value_idr) at the billing_settings
-- read on 2026-11-01 (18000 / 200 / 1.0): ceil(0.008 * 90) = ceil(0.72) = 1 credit ($0.0111),
-- margin at least $0.0031 (28%) per image.
-- The model_configs row is required: a Fal-only tier has no Replicate fallback, so without this row
-- (enabled, provider fal) its generations are refused with a retryable 503 before any spend.
-- Additive + idempotent (safe to re-run). on conflict do nothing never overwrites an admin edit.
-- The model ships Off: this file does not touch model_catalog_configs.
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('product_photo_krea_2_turbo_per_image', 'Product Photo — Krea 2 Turbo', 'per_image', 1, 0.008, 'per_image', 'product_photo', 'krea2_turbo', 'USD')
on conflict (pricing_key) do nothing;

-- Margin data only (billing never reads it). Fal is the only provider of this tier.
insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('fal', 'fal-ai/krea-2/turbo', 'product_photo_krea_2_turbo_per_image', 0.008, 'per_image')
on conflict (provider, model, pricing_key) do nothing;

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('photo', 'image_krea2_turbo', 'fal', 'fal-ai/krea-2/turbo', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
