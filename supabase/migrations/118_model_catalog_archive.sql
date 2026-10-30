-- 118_model_catalog_archive.sql
-- Admin Config: soft Remove / Restore of a generation model (archive).
-- Additive and idempotent. A removed model keeps its row, history, pricing and assets;
-- it is simply never offered (the constraint below makes "archived and offered" impossible).
-- The app works without this migration: Remove/Restore stay disabled until it is applied.
-- No RLS or grant change: model_catalog_configs keeps its 048 deny-by-default RLS
-- (service role only), and new columns inherit it.
alter table model_catalog_configs
  add column if not exists archived_at timestamptz;

alter table model_catalog_configs
  add column if not exists archived_by_profile_id uuid references profiles (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'model_catalog_configs_archived_disabled'
      and conrelid = 'model_catalog_configs'::regclass
  ) then
    alter table model_catalog_configs
      add constraint model_catalog_configs_archived_disabled
      check (archived_at is null or enabled = false);
  end if;
end
$$;
