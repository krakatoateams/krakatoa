-- 105_skill_video_defaults.sql
-- Master skills may pin video duration / resolution / aspect (e.g. Sailor Moon 15s 480p 9:16).
-- Null = follow the live model defaults. User-owned skills ignore these.
-- Additive, idempotent, non-destructive.

alter table skill_configs
  add column if not exists duration_sec integer;

alter table skill_configs
  add column if not exists resolution text;

alter table skill_configs
  add column if not exists aspect_ratio text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_duration_sec_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_duration_sec_check
      check (duration_sec is null or duration_sec in (5, 8, 10, 15));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_resolution_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_resolution_check
      check (resolution is null or resolution in ('480p', '720p', '1080p', '4k'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_aspect_ratio_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_aspect_ratio_check
      check (
        aspect_ratio is null
        or aspect_ratio in ('16:9', '4:3', '1:1', '3:4', '9:16', '21:9', '9:21', 'adaptive')
      );
  end if;
end $$;

-- Sailor Moon showcase skill: 15s · 480p · 9:16
update skill_configs
set
  duration_sec = 15,
  resolution = '480p',
  aspect_ratio = '9:16'
where skill_id = 'sailor-moon'
  and owner_profile_id is null;
