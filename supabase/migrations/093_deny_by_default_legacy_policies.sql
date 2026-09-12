-- 093_deny_by_default_legacy_policies.sql
-- Restore deny-by-default on leftover tables that still have client policies.
--
-- Live (not in supabase/migrations/):
--   storyboards: "anon can read storyboards" USING (true) — any anon key
--     can SELECT every storyboard (prompts, scene JSON, media URLs).
--   posts / platform_tokens: own-row FOR ALL — JWT can read/write posts
--     and OAuth tokens via PostgREST, bypassing API ownership checks.
--   users_deprecated: own-row FOR ALL — leftover NextAuth policy.
--
-- App DML uses the service role, which bypasses RLS. Dropping these
-- policies does not change server routes.
--
-- Also revoke PUBLIC EXECUTE on rls_auto_enable() (SECURITY DEFINER
-- event-trigger helper). It is not a product RPC.

do $$
begin
  if to_regclass('public.storyboards') is not null then
    execute 'drop policy if exists "anon can read storyboards" on public.storyboards';
    execute 'alter table public.storyboards enable row level security';
  end if;

  if to_regclass('public.posts') is not null then
    execute 'drop policy if exists "posts: own rows" on public.posts';
    execute 'alter table public.posts enable row level security';
  end if;

  if to_regclass('public.platform_tokens') is not null then
    execute 'drop policy if exists "platform_tokens: own rows" on public.platform_tokens';
    execute 'alter table public.platform_tokens enable row level security';
  end if;

  if to_regclass('public.users_deprecated') is not null then
    execute 'drop policy if exists "users: own row" on public.users_deprecated';
    execute 'alter table public.users_deprecated enable row level security';
  end if;

  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to service_role';
  end if;
end
$$;
