-- Viral / motion-control showcase clips may pin a standard duration (seconds)
-- measured from the preview video. Users cannot override it in the composer.

alter table trending_templates
  add column if not exists duration_sec integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trending_templates_duration_sec_check'
  ) then
    alter table trending_templates
      add constraint trending_templates_duration_sec_check
      check (duration_sec is null or (duration_sec >= 1 and duration_sec <= 120));
  end if;
end $$;
