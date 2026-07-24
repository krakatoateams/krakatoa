-- 047_video_composer_enablement.sql
-- Seed feature_model_configs rows for Video studio composers (tool_key = 'reels').
-- Idempotent: on conflict do nothing — admin edits are never clobbered.
-- Code catalog: lib/video-composer-features.ts (defaultVideoComposerRows).

insert into feature_model_configs (
  tool_key,
  feature_key,
  model_tier,
  enabled,
  is_default,
  sort_order
)
values
  ('reels', 'text2video', 'seedance15_pro', true, false, 0),
  ('reels', 'text2video', 'seedance1_pro_fast', true, false, 1),
  ('reels', 'text2video', 'seedance1_lite', true, false, 2),
  ('reels', 'text2video', 'seedance1_pro', true, false, 3),
  ('reels', 'text2video', 'seedance2_mini', true, false, 4),
  ('reels', 'text2video', 'seedance2_fast', true, true, 5),
  ('reels', 'text2video', 'seedance2', true, false, 6),
  ('reels', 'text2video', 'veo31_lite', true, false, 7),
  ('reels', 'text2video', 'veo31_fast', true, false, 8),
  ('reels', 'text2video', 'kling16_standard', true, false, 9),
  ('reels', 'text2video', 'kling25_turbo_pro', true, false, 10),
  ('reels', 'text2video', 'kling26', true, false, 11),
  ('reels', 'text2video', 'kling_v3', true, false, 12),
  ('reels', 'text2video', 'kling_v3_omni', true, false, 13),
  ('reels', 'image2video', 'kling15_standard', true, true, 0),
  ('reels', 'image2video', 'kling21', true, false, 1),
  ('reels', 'image2video', 'kling15_pro', true, false, 2),
  ('reels', 'image2video', 'kling16_pro', true, false, 3),
  ('reels', 'motion_control', 'kling26_motion', true, true, 0),
  ('reels', 'motion_control', 'kling_v3_motion', true, false, 1),
  ('reels', 'storyboard', 'seedance2_mini', true, true, 0),
  ('reels', 'storyboard', 'seedance2_fast', true, false, 1),
  ('reels', 'storyboard', 'seedance2', true, false, 2),
  ('reels', 'reels-creator', 'seedance15_pro', true, false, 0),
  ('reels', 'reels-creator', 'seedance2_mini', true, false, 1),
  ('reels', 'reels-creator', 'seedance2_fast', true, true, 2),
  ('reels', 'reels-creator', 'seedance2', true, false, 3),
  ('reels', 'reels-creator', 'veo31_lite', true, false, 4),
  ('reels', 'reels-creator', 'veo31_fast', true, false, 5)
on conflict (tool_key, feature_key, model_tier) do nothing;
