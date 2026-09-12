-- 092_krakatoa_rpc_grants.sql
-- Lock every public.krakatoa_* function to service_role.
--
-- Postgres grants EXECUTE to PUBLIC by default. Revoking only from anon /
-- authenticated does not remove that PUBLIC grant (see 061). Live project
-- still exposes the credit ledger RPCs and trigger helpers that way; RLS
-- deny-by-default currently blocks writes, but that is not the intended
-- lockdown. Workflow/admin RPCs were already tightened individually.
--
-- Idempotent. Safe to re-run.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'krakatoa_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end
$$;
