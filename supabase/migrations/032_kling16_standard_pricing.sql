-- 032_kling16_standard_pricing.sql
-- Kling v1.6 Standard (kwaivgi/kling-v1.6-standard) pricing + model config.
--
-- Text to Video (optional start_image + up to 4 reference_images). Flat: $0.05/s.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling16_standard_per_second', 'Kling v1.6 Standard (per sec)', 'per_second', 5, 0.05, 'per_second', 'kling16', 'standard', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'kling16_standard_per_second';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling16_standard', 'replicate', 'kwaivgi/kling-v1.6-standard', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
