-- 115_fal_nano_banana_provider_costs.sql
-- Phase 4 of the multi-provider rollout: provider cost rows for the three Nano Banana
-- tiers on fal.ai (margin/analytics only; billing reads pricing_configs.credit_amount).
-- Additive and idempotent. The app does not depend on these rows to run, so deploying
-- before this is applied is safe. Costs are from fal's published prices (not live-verified).
insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('fal', 'fal-ai/nano-banana', 'product_photo_nano_banana_per_image', 0.0398, 'per_image'),
  ('fal', 'fal-ai/nano-banana-2', 'product_photo_nano_banana_2_1k_per_image', 0.08, 'per_image'),
  ('fal', 'fal-ai/nano-banana-2', 'product_photo_nano_banana_2_2k_per_image', 0.12, 'per_image'),
  ('fal', 'fal-ai/nano-banana-2', 'product_photo_nano_banana_2_4k_per_image', 0.16, 'per_image'),
  ('fal', 'fal-ai/nano-banana-pro', 'product_photo_nano_banana_pro_1k_per_image', 0.15, 'per_image'),
  ('fal', 'fal-ai/nano-banana-pro', 'product_photo_nano_banana_pro_2k_per_image', 0.15, 'per_image'),
  ('fal', 'fal-ai/nano-banana-pro', 'product_photo_nano_banana_pro_4k_per_image', 0.3, 'per_image')
on conflict (provider, model, pricing_key) do nothing;
