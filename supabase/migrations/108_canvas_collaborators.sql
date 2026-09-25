-- 108_canvas_collaborators.sql
-- Email invites for shared canvas access (viewer or editor).
-- RLS deny-by-default; server routes use service role.

create table if not exists canvas_collaborators (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references canvases (id) on delete cascade,
  invited_email text not null,
  invitee_profile_id uuid references profiles (id) on delete set null,
  role text not null default 'editor' check (role in ('viewer', 'editor')),
  invited_by_profile_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint canvas_collaborators_email_len check (char_length(invited_email) <= 320),
  constraint canvas_collaborators_unique_email unique (canvas_id, invited_email)
);

create index if not exists canvas_collaborators_canvas_idx
  on canvas_collaborators (canvas_id);

create index if not exists canvas_collaborators_invitee_idx
  on canvas_collaborators (invitee_profile_id)
  where invitee_profile_id is not null;

create index if not exists canvas_collaborators_pending_email_idx
  on canvas_collaborators (invited_email)
  where status = 'pending';

alter table canvas_collaborators enable row level security;
