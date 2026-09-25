-- Hide USD checkout until a live USD processor is connected.
-- Default off. Admins turn it on from the Pricing page.

create table if not exists usd_checkout_settings (
  key text primary key default 'global' check (key = 'global'),
  enabled boolean not null default false,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists usd_checkout_settings_set_updated_at on usd_checkout_settings;
create trigger usd_checkout_settings_set_updated_at
  before update on usd_checkout_settings
  for each row execute function public.krakatoa_set_updated_at();

insert into usd_checkout_settings (key, enabled)
values ('global', false)
on conflict (key) do nothing;

alter table usd_checkout_settings enable row level security;
