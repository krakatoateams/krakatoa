-- 083_skill_hidden.sql
-- Admins can hide builtin catalog skills without deleting the code row.
-- Custom skills are still hard-deleted from skill_configs.
-- Additive, idempotent, non-destructive.

alter table skill_configs
  add column if not exists hidden boolean not null default false;
