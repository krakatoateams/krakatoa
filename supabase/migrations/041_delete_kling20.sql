-- 041_delete_kling20.sql
-- Hard-remove Kling v2.0 (never used in production). Replaces soft-deprecate from 040.

delete from pricing_configs
  where pricing_key = 'kling20_per_second';

delete from model_configs
  where tool_key = 'reels'
    and config_key = 'video_kling20';
