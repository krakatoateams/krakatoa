-- 036_kling26_motion_control_pricing.sql
-- Kling v2.6 Motion Control (kwaivgi/kling-v2.6-motion-control) pricing + model config.
--
-- Motion Control subtool. Priced by mode: std $0.07/s, pro $0.12/s (output follows ref video).
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling26mc_std_per_second', 'Kling v2.6 Motion Control Std (per sec)', 'per_second', 7, 0.07, 'per_second', 'kling26mc', 'std', 'USD'),
  ('kling26mc_pro_per_second', 'Kling v2.6 Motion Control Pro (per sec)', 'per_second', 11, 0.12, 'per_second', 'kling26mc', 'pro', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in ('kling26mc_std_per_second', 'kling26mc_pro_per_second');

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling26_motion', 'replicate', 'kwaivgi/kling-v2.6-motion-control', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
