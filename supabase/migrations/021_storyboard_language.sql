-- Storyboard spoken language: the language the dialogue/narration is written in
-- (and that Seedance speaks). Chosen at storyboard creation and re-used as the
-- default when turning it into a video (the video step may override it).
-- Default 'english' (the pipeline previously hardcoded Indonesian dialogue).
-- Additive + idempotent.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'storyboards'
  ) then
    alter table storyboards
      add column if not exists language text not null default 'english';
  end if;
end $$;
