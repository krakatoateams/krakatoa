-- 034_kling20_pricing.sql
-- Kling v2.0 (kwaivgi/kling-v2.0) pricing + model config.
--
-- Text to Video (optional start_image). Flat rate: $0.28/s output video.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling20_per_second', 'Kling v2.0 (per sec)', 'per_second', 28, 0.28, 'per_second', 'kling20', 'default', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'kling20_per_second';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling20', 'replicate', 'kwaivgi/kling-v2.0', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
