-- Storyboard aspect ratio: the orientation chosen at storyboard-creation time so
-- the storyboard→video clip is rendered in the SAME orientation (no vertical
-- storyboard producing a horizontal video). Additive + idempotent.
-- Existing rows default to '16:9' (the historical storyboard-video orientation).
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'storyboards'
  ) then
    alter table storyboards
      add column if not exists aspect_ratio text not null default '16:9';
  end if;
end $$;
