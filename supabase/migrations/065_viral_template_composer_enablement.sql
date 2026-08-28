-- 065_viral_template_composer_enablement.sql
-- Seed feature_model_configs for Viral template composer (tool_key = 'reels').
-- Eligible models: lib/video-composer-features.ts (supportsViralTemplateGeneration).

insert into feature_model_configs (
  tool_key,
  feature_key,
  model_tier,
  enabled,
  is_default,
  sort_order
)
values
  ('reels', 'viral_template', 'seedance2_mini', true, false, 0),
  ('reels', 'viral_template', 'seedance2_fast', true, true, 1),
  ('reels', 'viral_template', 'seedance2', true, false, 2),
  ('reels', 'viral_template', 'kling16_standard', true, false, 3),
  ('reels', 'viral_template', 'kling16_pro', true, false, 4),
  ('reels', 'viral_template', 'kling_v3_omni', true, false, 5)
on conflict (tool_key, feature_key, model_tier) do nothing;
