-- 035_kling21_pricing.sql
-- Kling v2.1 (kwaivgi/kling-v2.1) pricing + model config.
--
-- Image to Video (start_image required). Priced by mode: standard 720p $0.05/s, pro 1080p $0.09/s.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling21_standard_per_second', 'Kling v2.1 Standard (per sec)', 'per_second', 5, 0.05, 'per_second', 'kling21', 'standard', 'USD'),
  ('kling21_pro_per_second', 'Kling v2.1 Pro (per sec)', 'per_second', 9, 0.09, 'per_second', 'kling21', 'pro', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in ('kling21_standard_per_second', 'kling21_pro_per_second');

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling21', 'replicate', 'kwaivgi/kling-v2.1', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
