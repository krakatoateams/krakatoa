-- 042_seedance2_storyboard_model_config.sql
-- Seedance 2 full (bytedance/seedance-2.0) model config for Text/Storyboard video.
-- Pricing rows already live from 015_seedance2_full_pricing.sql.

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_seedance2', 'replicate', 'bytedance/seedance-2.0', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;
