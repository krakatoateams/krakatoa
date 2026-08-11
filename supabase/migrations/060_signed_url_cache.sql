-- 060_signed_url_cache.sql
-- Stable signed read URLs, so the browser can actually cache media.
--
-- Why this exists (measured on this project, Aug 2026):
-- Supabase Storage answers a conditional GET with 304 and a zero-byte body, so a
-- cached object costs nothing to revalidate. But a signed URL carries a token, and
-- re-signing the same object mints a *different* URL every time. A different URL is
-- a different cache entry: the browser has no ETag to send, so it re-downloads the
-- whole file. With a private bucket and per-request signing, every page view paid
-- full price for bytes it already had — which is what exhausted the 5 GB free-plan
-- egress quota while total stored media was only ~200 MB.
--
-- Caching the signed URL itself makes it stable across requests, instances, and
-- sessions, which restores both browser caching and Supabase CDN cache hits.
-- It must be shared state, not per-instance memory: two serverless instances that
-- hand out two different URLs for the same object defeat the whole point.
--
-- Additive and idempotent; safe to re-run via `npm run db:setup`.

create table if not exists public.signed_url_cache (
  storage_path text not null,
  -- Part of the key so two TTLs of the same object can never evict each other. Only
  -- the UI TTL is written today (see `cacheable` in lib/storage-signed-url.ts, which
  -- matches it exactly so untrusted `ttl` input cannot mint unbounded rows).
  ttl_sec integer not null,
  url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (storage_path, ttl_sec)
);

-- Supports the expired-row cleanup in the storage sweep cron.
create index if not exists signed_url_cache_expires_at_idx
  on public.signed_url_cache (expires_at);

-- Deny-by-default, consistent with every other table here: only the service role
-- (which bypasses RLS) reads or writes this. A leaked row is a usable media URL,
-- so this must never be reachable from the anon or authenticated key.
alter table public.signed_url_cache enable row level security;
