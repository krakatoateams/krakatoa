-- Replace the complete admin-managed credit-pack set in one transaction.
-- The function is SECURITY INVOKER and callable only by the service role.

create or replace function public.krakatoa_replace_credit_packs(p_packs jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_packs is null or jsonb_typeof(p_packs) <> 'array' then
    raise exception 'p_packs must be a JSON array';
  end if;

  delete from public.credit_packs existing
  where not exists (
    select 1
    from jsonb_to_recordset(p_packs) as incoming(id text)
    where incoming.id = existing.id
  );

  insert into public.credit_packs (
    id,
    credits,
    bonus_credits,
    price_idr,
    label,
    popular,
    is_active,
    sort_order
  )
  select
    incoming.id,
    incoming.credits,
    incoming.bonus_credits,
    incoming.price_idr,
    incoming.label,
    incoming.popular,
    incoming.is_active,
    incoming.sort_order
  from jsonb_to_recordset(p_packs) as incoming(
    id text,
    credits int,
    bonus_credits int,
    price_idr int,
    label text,
    popular boolean,
    is_active boolean,
    sort_order int
  )
  on conflict (id) do update
  set credits = excluded.credits,
      bonus_credits = excluded.bonus_credits,
      price_idr = excluded.price_idr,
      label = excluded.label,
      popular = excluded.popular,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.krakatoa_replace_credit_packs(jsonb)
  from public, anon, authenticated;
grant execute on function public.krakatoa_replace_credit_packs(jsonb)
  to service_role;
