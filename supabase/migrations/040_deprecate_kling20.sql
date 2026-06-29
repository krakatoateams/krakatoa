-- 040_deprecate_kling20.sql
-- Remove Kling v2.0 (kwaivgi/kling-v2.0) from active product surface.
-- Legacy pricing + model_config rows kept for audit; soft-disabled.

update pricing_configs
  set is_deprecated = true,
      enabled = false
  where pricing_key = 'kling20_per_second';

update model_configs
  set enabled = false,
      metadata = coalesce(metadata, '{}'::jsonb) || '{"deprecated": true}'::jsonb
  where tool_key = 'reels'
    and config_key = 'video_kling20';
