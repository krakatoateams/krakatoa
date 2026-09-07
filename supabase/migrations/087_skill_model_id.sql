-- 087_skill_model_id.sql
-- Admin-designated Photo/Video model for a master skill.
-- Null = catalog default (live Photo/Video default). User-owned skills ignore this.
-- Additive, idempotent, non-destructive.

alter table skill_configs
  add column if not exists model_id text;
