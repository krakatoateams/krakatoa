-- USD list price for each credit pack, in cents. Dummy amounts until Polar
-- checkout charges them. IDR remains the DOKU amount.

alter table public.credit_packs
  add column if not exists price_usd_cents int not null default 0
  check (price_usd_cents >= 0);

update public.credit_packs
set price_usd_cents = case id
  when 'p1' then 150
  when 'p3' then 375
  when 'p4' then 750
  when 'p5' then 1500
  else price_usd_cents
end
where price_usd_cents = 0
  and id in ('p1', 'p3', 'p4', 'p5');

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
    price_usd_cents,
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
    incoming.price_usd_cents,
    incoming.label,
    incoming.popular,
    incoming.is_active,
    incoming.sort_order
  from jsonb_to_recordset(p_packs) as incoming(
    id text,
    credits int,
    bonus_credits int,
    price_idr int,
    price_usd_cents int,
    label text,
    popular boolean,
    is_active boolean,
    sort_order int
  )
  on conflict (id) do update
  set credits = excluded.credits,
      bonus_credits = excluded.bonus_credits,
      price_idr = excluded.price_idr,
      price_usd_cents = excluded.price_usd_cents,
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
