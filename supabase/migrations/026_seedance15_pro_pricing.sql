-- 026_seedance15_pro_pricing.sql
-- Seedance 1.5 Pro (bytedance/seedance-1.5-pro) pricing + model config.
--
-- Text to Video only. Priced by resolution × audio:
--   with_audio:    480p $0.025/s · 720p $0.052/s · 1080p $0.12/s
--   without_audio: 480p $0.013/s · 720p $0.026/s · 1080p $0.06/s
--
-- Additive + idempotent — safe to re-run via `npm run db:setup` or Supabase MCP.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance15_480p_with_audio_per_second',    'Seedance 1.5 Pro 480p · With audio (per sec)',    'per_second', 3,  0.025, 'per_second', 'seedance15', '480p_with_audio',    'USD'),
  ('seedance15_720p_with_audio_per_second',    'Seedance 1.5 Pro 720p · With audio (per sec)',    'per_second', 5,  0.052, 'per_second', 'seedance15', '720p_with_audio',    'USD'),
  ('seedance15_1080p_with_audio_per_second',   'Seedance 1.5 Pro 1080p · With audio (per sec)',   'per_second', 11, 0.12,  'per_second', 'seedance15', '1080p_with_audio',   'USD'),
  ('seedance15_480p_without_audio_per_second', 'Seedance 1.5 Pro 480p · No audio (per sec)',      'per_second', 2,  0.013, 'per_second', 'seedance15', '480p_without_audio', 'USD'),
  ('seedance15_720p_without_audio_per_second', 'Seedance 1.5 Pro 720p · No audio (per sec)',      'per_second', 3,  0.026, 'per_second', 'seedance15', '720p_without_audio', 'USD'),
  ('seedance15_1080p_without_audio_per_second','Seedance 1.5 Pro 1080p · No audio (per sec)',     'per_second', 6,  0.06,  'per_second', 'seedance15', '1080p_without_audio','USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key like 'seedance15_%';

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance15_pro', 'replicate', 'bytedance/seedance-1.5-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
