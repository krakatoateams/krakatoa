-- 090_atomic_admin_revoke.sql
-- Serialize last-admin revoke so two concurrent DELETEs cannot leave zero
-- active admins. Service-role only; callers still gate with requireAdmin().

create or replace function public.krakatoa_revoke_admin(
  p_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.admin_users;
  v_active integer;
begin
  perform 1 from public.admin_users where status = 'active' order by id for update;

  select * into v_row
  from public.admin_users
  where id = p_id;

  if not found then
    return jsonb_build_object('action', 'not_found');
  end if;

  if v_row.status = 'active' then
    select count(*) into v_active
    from public.admin_users
    where status = 'active';

    if v_active <= 1 then
      return jsonb_build_object('action', 'last_admin');
    end if;
  end if;

  update public.admin_users
  set status = 'revoked',
      revoked_at = now()
  where id = p_id
  returning * into v_row;

  return jsonb_build_object('action', 'revoked', 'admin', to_jsonb(v_row));
end;
$$;

revoke execute on function public.krakatoa_revoke_admin(uuid) from public, anon, authenticated;
grant execute on function public.krakatoa_revoke_admin(uuid) to service_role;
