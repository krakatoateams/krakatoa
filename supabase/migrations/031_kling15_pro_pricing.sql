-- 031_kling15_pro_pricing.sql
-- Kling v1.5 Pro (kwaivgi/kling-v1.5-pro) pricing + model config.
--
-- Image to Video. Flat rate: $0.095/s output video. Requires start_image and/or end_image.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling15_pro_per_second', 'Kling v1.5 Pro (per sec)', 'per_second', 10, 0.095, 'per_second', 'kling15', 'pro', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'kling15_pro_per_second';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling15_pro', 'replicate', 'kwaivgi/kling-v1.5-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
