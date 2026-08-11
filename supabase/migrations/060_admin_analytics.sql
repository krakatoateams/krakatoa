-- 060_admin_analytics.sql
-- Backing data for the admin Analytics tab (/admin/analytics).
--
-- Two parts:
--   1. profiles.country — the app stores no geographic data at all today, so
--      this is captured going forward from Vercel's x-vercel-ip-country header
--      on the first authenticated request. Historical rows stay null ("Unknown"
--      in the UI) until that user next visits; there is no IP history to
--      backfill from.
--   2. Five aggregate functions. PostgREST cannot GROUP BY, and the existing
--      admin metrics helper aggregates in JS over a 5000-row cap (silently
--      truncating once the tables outgrow it). These push the grouping into
--      Postgres so the numbers stay exact.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security: functions are SECURITY INVOKER (the default). Only server routes
-- holding the service role call them, and EXECUTE is revoked from anon and
-- authenticated below so a leaked anon key cannot read platform-wide totals.

-- ---------------------------------------------------------------------------
-- 1. profiles.country
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists country text;

create index if not exists profiles_country_idx on profiles (country);

-- Supporting indexes for the day-bucketed rollup below.
create index if not exists jobs_created_at_idx on jobs (created_at);
create index if not exists credit_transactions_type_created_at_idx
  on credit_transactions (type, created_at);
create index if not exists credit_orders_status_paid_at_idx
  on credit_orders (status, paid_at);

-- ---------------------------------------------------------------------------
-- 2a. Daily rollup — powers both the Sales and DAU tables.
--
-- "Active" means the profile started at least one job that day; the app has no
-- session/heartbeat table, so browsing without generating does not count.
-- Orders bucket on paid_at (falling back to created_at) so revenue lands on the
-- day the money actually arrived. Days are UTC.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_admin_daily_metrics()
returns table (
  day date,
  active_users bigint,
  jobs_count bigint,
  credits_spent bigint,
  paid_orders bigint,
  revenue_idr bigint
)
language sql
stable
set search_path = ''
as $$
  with j as (
    select
      (created_at at time zone 'UTC')::date as day,
      count(*)::bigint as jobs_count,
      count(distinct profile_id)::bigint as active_users
    from public.jobs
    group by 1
  ),
  s as (
    select
      (created_at at time zone 'UTC')::date as day,
      coalesce(sum(amount), 0)::bigint as credits_spent
    from public.credit_transactions
    where type = 'spend' and status = 'succeeded'
    group by 1
  ),
  o as (
    select
      (coalesce(paid_at, created_at) at time zone 'UTC')::date as day,
      count(*)::bigint as paid_orders,
      coalesce(sum(amount_idr), 0)::bigint as revenue_idr
    from public.credit_orders
    where status = 'paid'
    group by 1
  ),
  all_days as (
    select day from j
    union
    select day from s
    union
    select day from o
  )
  select
    d.day,
    coalesce(j.active_users, 0)::bigint,
    coalesce(j.jobs_count, 0)::bigint,
    coalesce(s.credits_spent, 0)::bigint,
    coalesce(o.paid_orders, 0)::bigint,
    coalesce(o.revenue_idr, 0)::bigint
  from all_days d
  left join j on j.day = d.day
  left join s on s.day = d.day
  left join o on o.day = d.day
  order by d.day desc;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Feature usage — grouped by job_type (finer than jobs.tool, which lumps
-- text-to-video, image-to-video and motion control together under "reels").
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_admin_feature_usage()
returns table (
  job_type text,
  tool text,
  runs bigint,
  succeeded bigint,
  failed bigint,
  credits bigint
)
language sql
stable
set search_path = ''
as $$
  select
    j.job_type,
    -- job_type maps 1:1 to a tool in practice; max() just collapses the group.
    max(j.tool) as tool,
    count(*)::bigint as runs,
    count(*) filter (where j.status = 'succeeded')::bigint as succeeded,
    count(*) filter (where j.status = 'failed')::bigint as failed,
    coalesce(sum(j.cost_credits), 0)::bigint as credits
  from public.jobs j
  group by j.job_type
  order by runs desc;
$$;

-- ---------------------------------------------------------------------------
-- 2c. AI model usage. usage_events rows are only written on successful
-- generations, so these counts are lower than the job counts above.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_admin_model_usage()
returns table (
  provider text,
  model text,
  tool text,
  runs bigint,
  credits bigint
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(u.provider, 'unknown') as provider,
    coalesce(u.model, 'unknown') as model,
    max(u.tool) as tool,
    count(*)::bigint as runs,
    coalesce(sum(u.credits_charged), 0)::bigint as credits
  from public.usage_events u
  group by 1, 2
  order by runs desc;
$$;

-- ---------------------------------------------------------------------------
-- 2d. Package sales. pack_id is plain text (not a FK) so historical orders
-- survive pack edits/deletes — hence the label fallback chain: current pack
-- label, then the label snapshotted on the order, then the raw id.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_admin_pack_sales()
returns table (
  pack_id text,
  label text,
  orders bigint,
  credits_sold bigint,
  revenue_idr bigint
)
language sql
stable
set search_path = ''
as $$
  select
    o.pack_id,
    coalesce(max(p.label), max(o.metadata ->> 'packLabel'), o.pack_id) as label,
    count(*)::bigint as orders,
    coalesce(sum(o.credits), 0)::bigint as credits_sold,
    coalesce(sum(o.amount_idr), 0)::bigint as revenue_idr
  from public.credit_orders o
  left join public.credit_packs p on p.id = o.pack_id
  where o.status = 'paid'
  group by o.pack_id
  order by revenue_idr desc;
$$;

-- ---------------------------------------------------------------------------
-- 2e. Country breakdown. Rows predating the capture (or any local/non-Vercel
-- request) collapse into 'Unknown'.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_admin_country_breakdown()
returns table (
  country text,
  users bigint
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(nullif(trim(p.country), ''), 'Unknown') as country,
    count(*)::bigint as users
  from public.profiles p
  group by 1
  order by users desc;
$$;

-- ---------------------------------------------------------------------------
-- Lock the aggregates to the service role.
--
-- NOTE: these revokes are ineffective on their own — EXECUTE is granted to
-- PUBLIC by default and revoking from a named role does not override that.
-- 061_admin_analytics_grants.sql does the real lockdown (revoke from PUBLIC,
-- grant back to service_role). Kept here because 060 is already applied.
-- ---------------------------------------------------------------------------
revoke execute on function public.krakatoa_admin_daily_metrics() from anon, authenticated;
revoke execute on function public.krakatoa_admin_feature_usage() from anon, authenticated;
revoke execute on function public.krakatoa_admin_model_usage() from anon, authenticated;
revoke execute on function public.krakatoa_admin_pack_sales() from anon, authenticated;
revoke execute on function public.krakatoa_admin_country_breakdown() from anon, authenticated;
