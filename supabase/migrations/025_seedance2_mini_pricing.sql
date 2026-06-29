-- 025_seedance2_mini_pricing.sql
-- Seedance 2.0 Mini (bytedance/seedance-2.0-mini) pricing + model config.
--
-- Used by Storyboard to Video (default) and Text to Video. Cheaper than the Fast
-- variant; 480p/720p only (no 1080p tier). Like Fast, charges a higher per-second
-- rate when a reference VIDEO is provided ("video_in") vs not ("non_video_in").
--
-- Pricing (USD per second of output video):
--   480p : non_video_in $0.04 · video_in $0.05
--   720p : non_video_in $0.09 · video_in $0.11
--
-- Additive + idempotent — safe to re-run via `npm run db:setup`.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance2mini_480p_per_second',          'Seedance 2 Mini 480p (per sec)',                'per_second', 4,  0.04, 'per_second', 'seedance2mini', '480p',          'USD'),
  ('seedance2mini_720p_per_second',          'Seedance 2 Mini 720p (per sec)',                'per_second', 9,  0.09, 'per_second', 'seedance2mini', '720p',          'USD'),
  ('seedance2mini_480p_video_in_per_second', 'Seedance 2 Mini 480p · Video input (per sec)',  'per_second', 5,  0.05, 'per_second', 'seedance2mini', '480p_video_in', 'USD'),
  ('seedance2mini_720p_video_in_per_second', 'Seedance 2 Mini 720p · Video input (per sec)',  'per_second', 10, 0.11, 'per_second', 'seedance2mini', '720p_video_in', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'seedance2mini_480p_per_second',
      'seedance2mini_720p_per_second',
      'seedance2mini_480p_video_in_per_second',
      'seedance2mini_720p_video_in_per_second'
    );

-- Admin-overridable model role for Mini (Text to Video + Storyboard UI picker).
insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance2_mini', 'replicate', 'bytedance/seedance-2.0-mini', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;

-- Storyboard pipeline default: Mini (reference-image storyboard renders).
update model_configs
  set model = 'bytedance/seedance-2.0-mini'
  where tool_key = 'storyboard'
    and config_key = 'video'
    and model = 'bytedance/seedance-2.0-fast';
