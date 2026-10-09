-- 110_gpt_image_2_product_photo_pricing.sql
-- GPT Image 2 (openai/gpt-image-2) for Product Photo / Canvas, priced per output image by quality.
-- Replicate source: https://replicate.com/openai/gpt-image-2 (checked 2026-10-09): low $0.012, medium $0.047, high $0.128.
-- Additive + idempotent (safe to re-run via `npm run db:setup`). credit_amount is only the DB fallback;
-- runtime credits are resolved from provider_cost_usd and the admin billing settings.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('product_photo_gpt_image_2_low_per_image',    'Product Photo — GPT Image 2 Low',    'per_image', 2,  0.012, 'per_image', 'product_photo', 'low',    'USD'),
  ('product_photo_gpt_image_2_medium_per_image', 'Product Photo — GPT Image 2 Medium', 'per_image', 5,  0.047, 'per_image', 'product_photo', 'medium', 'USD'),
  ('product_photo_gpt_image_2_high_per_image',   'Product Photo — GPT Image 2 High',   'per_image', 12, 0.128, 'per_image', 'product_photo', 'high',   'USD')
on conflict (pricing_key) do nothing;
