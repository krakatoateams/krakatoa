-- 039_kling_v3_omni_pricing.sql
-- Kling v3 Omni (kwaivgi/kling-v3-omni-video) pricing + model config.
--
-- Text to Video with reference images/video + optional frames. Priced by mode × audio:
--   standard 720p  no audio $0.168 · audio $0.224
--   pro      1080p no audio $0.224 · audio $0.28
--   4k               $0.42 (audio or not)
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling3omni_standard_per_second',       'Kling v3 Omni Standard 720p (per sec)',         'per_second', 17, 0.168, 'per_second', 'kling3omni', 'standard',       'USD'),
  ('kling3omni_standard_audio_per_second', 'Kling v3 Omni Standard 720p · Audio (per sec)', 'per_second', 22, 0.224, 'per_second', 'kling3omni', 'standard_audio', 'USD'),
  ('kling3omni_pro_per_second',            'Kling v3 Omni Pro 1080p (per sec)',             'per_second', 22, 0.224, 'per_second', 'kling3omni', 'pro',            'USD'),
  ('kling3omni_pro_audio_per_second',      'Kling v3 Omni Pro 1080p · Audio (per sec)',     'per_second', 28, 0.28,  'per_second', 'kling3omni', 'pro_audio',      'USD'),
  ('kling3omni_4k_per_second',             'Kling v3 Omni 4K (per sec)',                    'per_second', 42, 0.42,  'per_second', 'kling3omni', '4k',             'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'kling3omni_standard_per_second',
      'kling3omni_standard_audio_per_second',
      'kling3omni_pro_per_second',
      'kling3omni_pro_audio_per_second',
      'kling3omni_4k_per_second'
    );

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_kling_v3_omni', 'replicate', 'kwaivgi/kling-v3-omni-video', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
