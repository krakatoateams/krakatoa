-- Storyboard source: distinguishes storyboards GENERATED in Krakatoa (the GPT
-- Image sheet flow) from ones the user UPLOADED themselves (analyzed by GPT-5
-- vision to synthesize a seedance_prompt). Lets the picker badge "Uploaded" and
-- keeps analytics clean. Additive + idempotent. Existing rows default to
-- 'generated' (the only historical source).
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'storyboards'
  ) then
    alter table storyboards
      add column if not exists source text not null default 'generated';
  end if;
end $$;
