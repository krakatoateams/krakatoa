-- 028_seedance1_pro_pricing.sql
-- Seedance 1 Pro (bytedance/seedance-1-pro) pricing + model config.
--
-- Text to Video only. No audio — priced by resolution:
--   480p $0.03/s · 720p $0.06/s · 1080p $0.15/s
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance1pro_480p_per_second',  'Seedance 1 Pro 480p (per sec)',  'per_second', 3,  0.03, 'per_second', 'seedance1pro', '480p',  'USD'),
  ('seedance1pro_720p_per_second',  'Seedance 1 Pro 720p (per sec)',  'per_second', 6,  0.06, 'per_second', 'seedance1pro', '720p',  'USD'),
  ('seedance1pro_1080p_per_second', 'Seedance 1 Pro 1080p (per sec)', 'per_second', 14, 0.15, 'per_second', 'seedance1pro', '1080p', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key like 'seedance1pro_%';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance1_pro', 'replicate', 'bytedance/seedance-1-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
