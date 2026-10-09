-- 110_notifications.sql
-- In-app Notifications (see CONTEXT.md, docs/adr/0001-notifications-via-db-triggers.md).
--
-- Rows are written ONLY by the triggers below, at the moment the underlying
-- record reaches its outcome — so every code path that finishes a job, a post
-- or creates a canvas invite is covered without hooks in app code.
--
-- Every trigger body is best-effort: any error is downgraded to a WARNING so
-- a notification problem can never roll back or mask the job/post/invite
-- write that fired it.
--
-- RLS deny-by-default; server routes use the service role and scope every
-- query by profile_id in code. Idempotent and additive.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (
    kind in (
      'generation_succeeded',
      'generation_failed',
      'post_published',
      'post_failed',
      'canvas_invited'
    )
  ),
  -- One row per real-world event, so replays and re-fires are no-ops.
  dedupe_key text not null,
  -- Small snapshot for rendering; copy is derived at read time
  -- (lib/notifications-pure.ts). A failed post's last_error is kept here so
  -- its advice can't change after a retry — server-side only, never sent to
  -- the client (the API returns rendered copy).
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_dedupe_unique unique (profile_id, dedupe_key)
);

create index if not exists notifications_profile_created_idx
  on notifications (profile_id, created_at desc);

create index if not exists notifications_profile_unread_idx
  on notifications (profile_id)
  where read_at is null;

-- Retention sweep (/api/cron/notifications-prune).
create index if not exists notifications_created_idx
  on notifications (created_at);

alter table notifications enable row level security;

-- ---------------------------------------------------------------------------
-- Jobs: generation succeeded / failed. Skipped: user cancellations (the
-- 'cancelled' status and GENERATION_CANCELLED failures) and failures the user
-- already saw as the request's own error (INSUFFICIENT_CREDITS → 402,
-- GENERATION_SETUP_FAILED).
-- 'recoverable' is not an outcome (credits are held for retry), so it never
-- notifies.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_notify_job_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return null;
    end if;
    if new.status = 'failed'
      and coalesce(new.error ->> 'code', '') in (
        'GENERATION_CANCELLED',
        'INSUFFICIENT_CREDITS',
        'GENERATION_SETUP_FAILED'
      ) then
      return null;
    end if;

    insert into notifications (profile_id, kind, dedupe_key, data)
    values (
      new.profile_id,
      case new.status when 'succeeded' then 'generation_succeeded' else 'generation_failed' end,
      'job:' || new.id::text || ':' || new.status,
      jsonb_build_object('job_id', new.id, 'tool', new.tool, 'job_type', new.job_type)
    )
    on conflict (profile_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'krakatoa_notify_job_outcome failed for job %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists jobs_notify_outcome on public.jobs;
create trigger jobs_notify_outcome
  after insert or update of status on public.jobs
  for each row
  -- Keeps the hot non-terminal updates (queued/running/recoverable) free of
  -- the trigger's exception-block savepoint.
  when (new.status in ('succeeded', 'failed'))
  execute function public.krakatoa_notify_job_outcome();

-- ---------------------------------------------------------------------------
-- Posts: published / failed. One post = one platform = one Notification.
-- The status-transition guard is the real dedupe here; the key includes the
-- transaction time so a post that is re-armed and fails again notifies again.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_notify_post_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  begin
    if tg_op = 'UPDATE' and old.status is not distinct from new.status then
      return null;
    end if;

    v_profile_id := new.profile_id;
    if v_profile_id is null then
      select p.id into v_profile_id
      from profiles p
      where p.user_id = new.user_id::text::uuid
      limit 1;
    end if;
    if v_profile_id is null then
      return null;
    end if;

    insert into notifications (profile_id, kind, dedupe_key, data)
    values (
      v_profile_id,
      case new.status when 'published' then 'post_published' else 'post_failed' end,
      'post:' || new.id::text || ':' || new.status || ':' || now()::text,
      jsonb_build_object(
        'post_id', new.id,
        'platform', new.platform,
        'title', left(coalesce(new.title, ''), 120),
        'last_error', case when new.status = 'failed' then left(new.last_error, 1000) end
      )
    )
    on conflict (profile_id, dedupe_key) do nothing;
  exception when others then
    raise warning 'krakatoa_notify_post_outcome failed for post %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists posts_notify_outcome on public.posts;
create trigger posts_notify_outcome
  after insert or update of status on public.posts
  for each row
  when (new.status in ('published', 'failed'))
  execute function public.krakatoa_notify_post_outcome();

-- ---------------------------------------------------------------------------
-- Canvas invitations. Shared insert helper used by both the invite trigger
-- (invitee already has an account) and the profile trigger (invitee signs up
-- later). Self-invites are rejected upstream; skipped here too.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_insert_canvas_invite_notification(
  p_collaborator canvas_collaborators,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canvas_title text;
  v_inviter_name text;
begin
  if p_profile_id is null or p_profile_id = p_collaborator.invited_by_profile_id then
    return;
  end if;

  select c.title into v_canvas_title from canvases c where c.id = p_collaborator.canvas_id;
  select coalesce(nullif(trim(p.display_name), ''), p.email)
    into v_inviter_name
  from profiles p
  where p.id = p_collaborator.invited_by_profile_id;

  insert into notifications (profile_id, kind, dedupe_key, data)
  values (
    p_profile_id,
    'canvas_invited',
    'canvas_invite:' || p_collaborator.id::text,
    jsonb_build_object(
      'canvas_id', p_collaborator.canvas_id,
      'canvas_title', v_canvas_title,
      'inviter_name', v_inviter_name,
      'role', p_collaborator.role
    )
  )
  on conflict (profile_id, dedupe_key) do nothing;
end;
$$;

create or replace function public.krakatoa_notify_canvas_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  begin
    -- The app resolves the invitee when it already has an account; only fall
    -- back to the same exact-email match it uses (lib/canvas-collaborators-db.ts).
    v_profile_id := new.invitee_profile_id;
    if v_profile_id is null then
      select p.id into v_profile_id
      from profiles p
      where p.email = new.invited_email
      limit 1;
    end if;

    perform public.krakatoa_insert_canvas_invite_notification(new, v_profile_id);
  exception when others then
    raise warning 'krakatoa_notify_canvas_invite failed for collaborator %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists canvas_collaborators_notify_invite on public.canvas_collaborators;
create trigger canvas_collaborators_notify_invite
  after insert on public.canvas_collaborators
  for each row execute function public.krakatoa_notify_canvas_invite();

create or replace function public.krakatoa_notify_pending_canvas_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collaborator canvas_collaborators;
begin
  begin
    if new.email is null or trim(new.email) = '' then
      return null;
    end if;
    if tg_op = 'UPDATE' and old.email is not distinct from new.email then
      return null;
    end if;

    for v_collaborator in
      select cc.*
      from canvas_collaborators cc
      where cc.invited_email = lower(trim(new.email))
        and (cc.invitee_profile_id is null or cc.invitee_profile_id = new.id)
    loop
      perform public.krakatoa_insert_canvas_invite_notification(v_collaborator, new.id);
    end loop;
  exception when others then
    raise warning 'krakatoa_notify_pending_canvas_invites failed for profile %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists profiles_notify_pending_canvas_invites on public.profiles;
create trigger profiles_notify_pending_canvas_invites
  after insert or update of email on public.profiles
  for each row execute function public.krakatoa_notify_pending_canvas_invites();

-- Trigger functions are not meant to be called directly by API roles.
revoke all on function public.krakatoa_insert_canvas_invite_notification(canvas_collaborators, uuid)
  from public, anon, authenticated;
