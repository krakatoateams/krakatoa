-- 079_skill_custom.sql
-- Admin-created skills (not only overlays on the code catalog), plus
-- media type and per-slot required/optional/hidden inputs.
--
-- Additive, idempotent, non-destructive.
-- RLS already enabled on skill_configs; no new policies (service role + requireAdmin).

alter table skill_configs
  add column if not exists origin text not null default 'overlay';

alter table skill_configs
  add column if not exists media_type text;

alter table skill_configs
  add column if not exists inputs jsonb;

alter table skill_configs
  add column if not exists icon text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_origin_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_origin_check
      check (origin in ('overlay', 'custom'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_media_type_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_media_type_check
      check (media_type is null or media_type in ('image', 'video'));
  end if;
end $$;
