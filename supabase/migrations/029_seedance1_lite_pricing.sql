-- 029_seedance1_lite_pricing.sql
-- Seedance 1 Lite (bytedance/seedance-1-lite) pricing + model config.
--
-- Text to Video only. No audio — priced by resolution:
--   480p $0.018/s · 720p $0.036/s · 1080p $0.072/s
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance1lite_480p_per_second',  'Seedance 1 Lite 480p (per sec)',  'per_second', 2, 0.018, 'per_second', 'seedance1lite', '480p',  'USD'),
  ('seedance1lite_720p_per_second',  'Seedance 1 Lite 720p (per sec)',  'per_second', 4, 0.036, 'per_second', 'seedance1lite', '720p',  'USD'),
  ('seedance1lite_1080p_per_second', 'Seedance 1 Lite 1080p (per sec)', 'per_second', 7, 0.072, 'per_second', 'seedance1lite', '1080p', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key like 'seedance1lite_%';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance1_lite', 'replicate', 'bytedance/seedance-1-lite', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
