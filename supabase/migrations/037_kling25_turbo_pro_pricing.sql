-- 037_kling25_turbo_pro_pricing.sql
-- Kling v2.5 Turbo Pro (kwaivgi/kling-v2.5-turbo-pro) pricing + model config.
--
-- Text to Video with optional start/end frames. Flat $0.07/s.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling25turbo_per_second', 'Kling v2.5 Turbo Pro (per sec)', 'per_second', 7, 0.07, 'per_second', 'kling25turbo', 'default', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in ('kling25turbo_per_second');

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling25_turbo_pro', 'replicate', 'kwaivgi/kling-v2.5-turbo-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
