-- 027_seedance1_pro_fast_pricing.sql
-- Seedance 1 Pro Fast (bytedance/seedance-1-pro-fast) pricing + model config.
--
-- Text to Video only. No audio generation — priced by resolution:
--   480p $0.015/s · 720p $0.025/s · 1080p $0.06/s
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance1fast_480p_per_second',  'Seedance 1 Pro Fast 480p (per sec)',  'per_second', 2, 0.015, 'per_second', 'seedance1fast', '480p',  'USD'),
  ('seedance1fast_720p_per_second',  'Seedance 1 Pro Fast 720p (per sec)',  'per_second', 3, 0.025, 'per_second', 'seedance1fast', '720p',  'USD'),
  ('seedance1fast_1080p_per_second', 'Seedance 1 Pro Fast 1080p (per sec)', 'per_second', 6, 0.06,  'per_second', 'seedance1fast', '1080p', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key like 'seedance1fast_%';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance1_pro_fast', 'replicate', 'bytedance/seedance-1-pro-fast', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
