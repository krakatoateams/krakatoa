-- 116_fal_gpt_image_flare_provider_costs.sql
-- Phase 5 of the multi-provider rollout: provider cost rows for GPT Image 2.5 Flare on fal.ai
-- (margin/analytics only; billing reads pricing_configs.credit_amount).
-- APPROXIMATIONS: Fal bills by tokens, so the real cost varies with size and reference count.
-- These are flat per-quality text-to-image figures at 1024x1024 from fal's published examples
-- (not live-verified); edit calls and extra references cost more (about 0.0142 / 0.0215 / 0.061
-- per edit, plus roughly 0.008-0.012 per reference).
-- Additive and idempotent. The app does not depend on these rows to run, so deploying
-- before this is applied is safe.
insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('fal', 'openai/gpt-image-2.5/flare/text-to-image', 'product_photo_gpt_image_2_low_per_image', 0.006, 'per_image'),
  ('fal', 'openai/gpt-image-2.5/flare/text-to-image', 'product_photo_gpt_image_2_medium_per_image', 0.0133, 'per_image'),
  ('fal', 'openai/gpt-image-2.5/flare/text-to-image', 'product_photo_gpt_image_2_high_per_image', 0.0528, 'per_image')
on conflict (provider, model, pricing_key) do nothing;
