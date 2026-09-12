-- 091_auth_users_fk_cutover.sql
-- Record the live NextAuth → auth.users identity FK cutover.
--
-- Production already points profiles, user_creations, platform_tokens, posts,
-- and storyboards at auth.users; public.users is users_deprecated;
-- product_photo_generations is absent. This migration is a no-op on that
-- shape. It never rematches user_id by email. Orphan user_id values fail
-- closed. users_deprecated is kept.
--
-- posts.user_id keeps ON DELETE CASCADE (live). The deferred remap script's
-- SET NULL is not the production contract.

do $$
declare
  t record;
  v_exists boolean;
  v_has_user_id boolean;
  v_orphans text := '';
  v_count bigint;
  v_def text;
  v_conname text;
  v_already_auth boolean;
begin
  for t in
    select * from (values
      ('profiles', 'profiles_user_id_fkey', 'CASCADE'),
      ('user_creations', 'user_creations_user_id_fkey', 'CASCADE'),
      ('platform_tokens', 'platform_tokens_user_id_fkey', 'CASCADE'),
      ('posts', 'posts_user_id_fkey', 'CASCADE'),
      ('storyboards', 'storyboards_user_id_fkey', 'SET NULL'),
      ('product_photo_generations', 'product_photo_generations_user_id_fkey', 'CASCADE')
    ) as x(table_name, constraint_name, on_delete)
  loop
    select to_regclass(format('public.%I', t.table_name)) is not null
      into v_exists;
    if not v_exists then
      continue;
    end if;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = t.table_name
        and column_name = 'user_id'
    ) into v_has_user_id;
    if not v_has_user_id then
      continue;
    end if;

    execute format(
      'select count(*) from public.%I r
       where r.user_id is not null
         and not exists (select 1 from auth.users a where a.id = r.user_id)',
      t.table_name
    ) into v_count;
    if v_count > 0 then
      v_orphans := v_orphans || format('%s=%s ', t.table_name, v_count);
    end if;
  end loop;

  if v_orphans <> '' then
    raise exception 'auth_users_fk_cutover: orphan user_id values remain: %', btrim(v_orphans);
  end if;

  for t in
    select * from (values
      ('profiles', 'profiles_user_id_fkey', 'CASCADE'),
      ('user_creations', 'user_creations_user_id_fkey', 'CASCADE'),
      ('platform_tokens', 'platform_tokens_user_id_fkey', 'CASCADE'),
      ('posts', 'posts_user_id_fkey', 'CASCADE'),
      ('storyboards', 'storyboards_user_id_fkey', 'SET NULL'),
      ('product_photo_generations', 'product_photo_generations_user_id_fkey', 'CASCADE')
    ) as x(table_name, constraint_name, on_delete)
  loop
    select to_regclass(format('public.%I', t.table_name)) is not null
      into v_exists;
    if not v_exists then
      continue;
    end if;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = t.table_name
        and column_name = 'user_id'
    ) into v_has_user_id;
    if not v_has_user_id then
      continue;
    end if;

    v_already_auth := false;
    for v_conname, v_def in
      select c.conname, pg_get_constraintdef(c.oid)
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
        and rel.relname = t.table_name
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid) ~* 'foreign key \(user_id\)'
    loop
      if v_def ~* 'references auth\.users' then
        v_already_auth := true;
      end if;
    end loop;

    if v_already_auth then
      continue;
    end if;

    for v_conname in
      select c.conname
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
        and rel.relname = t.table_name
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid) ~* 'foreign key \(user_id\)'
    loop
      execute format(
        'alter table public.%I drop constraint if exists %I',
        t.table_name,
        v_conname
      );
    end loop;

    if t.on_delete = 'SET NULL' then
      execute format(
        'alter table public.%I add constraint %I
         foreign key (user_id) references auth.users(id) on delete set null',
        t.table_name,
        t.constraint_name
      );
    else
      execute format(
        'alter table public.%I add constraint %I
         foreign key (user_id) references auth.users(id) on delete cascade',
        t.table_name,
        t.constraint_name
      );
    end if;
  end loop;

  if to_regclass('public.users') is not null
     and to_regclass('public.users_deprecated') is null then
    alter table public.users rename to users_deprecated;
  end if;
end $$;
