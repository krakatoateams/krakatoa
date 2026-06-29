-- 038_kling26_pricing.sql
-- Kling v2.6 (kwaivgi/kling-v2.6) pricing + model config.
--
-- Text to Video with optional start_image. Priced by generate_audio:
-- without audio $0.07/s, with audio $0.14/s.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling26_without_audio_per_second', 'Kling v2.6 without audio (per sec)', 'per_second', 7, 0.07, 'per_second', 'kling26', 'without_audio', 'USD'),
  ('kling26_with_audio_per_second', 'Kling v2.6 with audio (per sec)', 'per_second', 14, 0.14, 'per_second', 'kling26', 'with_audio', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in ('kling26_without_audio_per_second', 'kling26_with_audio_per_second');

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling26', 'replicate', 'kwaivgi/kling-v2.6', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
