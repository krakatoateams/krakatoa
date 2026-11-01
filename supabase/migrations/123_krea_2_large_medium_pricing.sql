-- 123_krea_2_large_medium_pricing.sql
-- Krea 2 Large and Krea 2 Medium for Product Photo, text-to-image only (#474).
-- Both run on Replicate by default with fal.ai as a switchable second provider. Prices checked 2026-11-01,
-- flat per output image (text-to-image, no style references or moodboard), any aspect ratio:
--   Large   Replicate krea/krea-2-large  $0.06  (https://replicate.com/krea/krea-2-large)
--           fal krea/v2/large/text-to-image  $0.060  (https://fal.ai/models/krea/v2/large/text-to-image)
--   Medium  Replicate krea/krea-2-medium $0.03  (https://replicate.com/krea/krea-2-medium)
--           fal krea/v2/medium/text-to-image $0.030 (https://fal.ai/models/krea/v2/medium/text-to-image)
-- credits = ceil(highest provider cost * usd_to_idr * margin_multiplier / credit_value_idr) at the
-- billing_settings read on 2026-11-01 (18000 / 200 / 1.0):
--   Large   ceil(0.06 * 90) = ceil(5.4) = 6 credits ($0.0667), margin $0.0067 (10%) on either provider
--   Medium  ceil(0.03 * 90) = ceil(2.7) = 3 credits ($0.0333), margin $0.0033 (10%) on either provider
-- The model_configs rows are the Replicate default (the same row the admin provider switch would seed).
-- Additive + idempotent (safe to re-run). on conflict do nothing never overwrites an admin edit.
-- Both models ship Off: this file does not touch model_catalog_configs.
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('product_photo_krea_2_large_per_image',  'Product Photo — Krea 2 Large',  'per_image', 6, 0.06, 'per_image', 'product_photo', 'krea2_large',  'USD'),
  ('product_photo_krea_2_medium_per_image', 'Product Photo — Krea 2 Medium', 'per_image', 3, 0.03, 'per_image', 'product_photo', 'krea2_medium', 'USD')
on conflict (pricing_key) do nothing;

-- Margin data only (billing never reads it). One row per provider the tier can run on.
insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('replicate', 'krea/krea-2-large',             'product_photo_krea_2_large_per_image',  0.06, 'per_image'),
  ('fal',       'krea/v2/large/text-to-image',   'product_photo_krea_2_large_per_image',  0.06, 'per_image'),
  ('replicate', 'krea/krea-2-medium',            'product_photo_krea_2_medium_per_image', 0.03, 'per_image'),
  ('fal',       'krea/v2/medium/text-to-image',  'product_photo_krea_2_medium_per_image', 0.03, 'per_image')
on conflict (provider, model, pricing_key) do nothing;

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('photo', 'image_krea2_large',  'replicate', 'krea/krea-2-large',  true, '{}'::jsonb),
  ('photo', 'image_krea2_medium', 'replicate', 'krea/krea-2-medium', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
