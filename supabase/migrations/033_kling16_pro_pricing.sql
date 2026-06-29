-- 033_kling16_pro_pricing.sql
-- Kling v1.6 Pro (kwaivgi/kling-v1.6-pro) pricing + model config.
--
-- Image to Video (start/end image required + up to 4 reference_images). $0.095/s.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling16_pro_per_second', 'Kling v1.6 Pro (per sec)', 'per_second', 10, 0.095, 'per_second', 'kling16', 'pro', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'kling16_pro_per_second';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling16_pro', 'replicate', 'kwaivgi/kling-v1.6-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
