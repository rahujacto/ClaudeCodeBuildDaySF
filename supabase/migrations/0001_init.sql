-- Pulse — schema + Row-Level Security.
-- Run this in the Supabase SQL editor (or via the CLI) once per project.
-- Users come from auth.users (managed by Supabase Auth / Google provider).

-- ── connections ────────────────────────────────────────────────────────────
-- One row per (user, source). Non-secret config lives in `config`; the
-- encrypted token (AES-256-GCM ciphertext, base64) lives in `secret_ref`.
create table if not exists public.connections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in
                ('shopify','ga4','google_ads','meta_ads','email')),
  status      text not null default 'disconnected', -- connected|seeded|disconnected
  config      jsonb not null default '{}',           -- NON-secret fields only
  secret_ref  text,                                  -- encrypted secret payload
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, source)
);

alter table public.connections enable row level security;

drop policy if exists "own rows" on public.connections;
create policy "own rows" on public.connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── metric_cache ───────────────────────────────────────────────────────────
-- Optional cache of pulled metrics to speed the dashboard + reduce API calls.
create table if not exists public.metric_cache (
  user_id    uuid not null references auth.users(id) on delete cascade,
  source     text not null,
  day        date not null,
  payload    jsonb not null,
  fetched_at timestamptz default now(),
  primary key (user_id, source, day)
);

alter table public.metric_cache enable row level security;

drop policy if exists "own cache" on public.metric_cache;
create policy "own cache" on public.metric_cache
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- keep updated_at fresh on connections
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists connections_touch on public.connections;
create trigger connections_touch before update on public.connections
  for each row execute function public.touch_updated_at();
