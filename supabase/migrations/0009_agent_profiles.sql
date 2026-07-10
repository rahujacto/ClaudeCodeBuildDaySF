-- 0009 — Agent profiles: the layered system prompt behind the Pulse assistant.
-- One row per org. `layers` holds the editable prompt sections (core, business
-- model, customers, competitors, ad strategy) as JSON {key: markdown string}.

create table if not exists public.agent_profiles (
  org_id       uuid primary key references public.orgs(id) on delete cascade,
  layers       jsonb not null default '{}',
  generated_at timestamptz,           -- last auto-generation (null = never)
  updated_at   timestamptz default now(),
  updated_by   uuid references auth.users(id)
);

alter table public.agent_profiles enable row level security;

drop policy if exists "agent members read" on public.agent_profiles;
create policy "agent members read" on public.agent_profiles for select
  using (public.is_org_member(org_id));

drop policy if exists "agent admins write" on public.agent_profiles;
create policy "agent admins write" on public.agent_profiles for all
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop trigger if exists agent_profiles_touch on public.agent_profiles;
create trigger agent_profiles_touch before update on public.agent_profiles
  for each row execute function public.touch_updated_at();
