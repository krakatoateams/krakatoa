-- 061_admin_analytics_grants.sql
-- Fixes the privilege lockdown on the analytics functions from 060.
--
-- 060 used `revoke execute ... from anon, authenticated`, which does nothing:
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- revoking from an individual role does not override the PUBLIC grant. Verified
-- against the live project — the anon key could call all five functions and got
-- HTTP 200 (empty arrays, because the functions are SECURITY INVOKER and RLS is
-- deny-by-default on the underlying tables, but that is RLS saving us rather
-- than the intended lock).
--
-- The correct pattern is revoke from PUBLIC, then grant back explicitly. Note
-- that service_role's EXECUTE also comes from the PUBLIC grant, so it has to be
-- granted back by name or the admin routes break.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.krakatoa_admin_daily_metrics()',
    'public.krakatoa_admin_feature_usage()',
    'public.krakatoa_admin_model_usage()',
    'public.krakatoa_admin_pack_sales()',
    'public.krakatoa_admin_country_breakdown()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
