-- 084_skill_owner.sql
-- User-created skills are private to the profile that made them.
-- Catalog overlays and existing admin custom rows stay global (owner null).
-- Additive, idempotent, non-destructive.

alter table skill_configs
  add column if not exists owner_profile_id uuid references profiles (id) on delete cascade;

create index if not exists skill_configs_owner_profile_id_idx
  on skill_configs (owner_profile_id)
  where owner_profile_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'skill_configs_owner_custom_check'
  ) then
    alter table skill_configs
      add constraint skill_configs_owner_custom_check
      check (owner_profile_id is null or origin = 'custom');
  end if;
end $$;
