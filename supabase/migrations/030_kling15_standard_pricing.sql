-- 030_kling15_standard_pricing.sql
-- Kling v1.5 Standard (kwaivgi/kling-v1.5-standard) pricing + model config.
--
-- Text to Video (image-to-video only). Flat rate: $0.05/s output video.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling15_standard_per_second', 'Kling v1.5 Standard (per sec)', 'per_second', 5, 0.05, 'per_second', 'kling15', 'standard', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'kling15_standard_per_second';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling15_standard', 'replicate', 'kwaivgi/kling-v1.5-standard', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
