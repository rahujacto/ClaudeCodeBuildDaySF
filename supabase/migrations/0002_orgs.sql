-- 0002 — Orgs / multi-tenant connectors with Admin/Member roles.
-- Connectors become owned by an org; any member can read (and view dashboards),
-- only admins can create/edit. Existing per-user connections are migrated into a
-- personal org (the user becomes its admin).

create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My Org',
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table if not exists public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz default now(),
  primary key (org_id, user_id)
);

create table if not exists public.org_invites (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin','member')),
  invited_by uuid references auth.users(id),
  created_at timestamptz default now(),
  primary key (org_id, email)
);

-- ── helper predicates (SECURITY DEFINER: bypass RLS, avoid recursion) ────────
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid() and role = 'admin'
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.orgs enable row level security;
drop policy if exists "org read" on public.orgs;
create policy "org read" on public.orgs for select using (public.is_org_member(id));
drop policy if exists "org update admin" on public.orgs;
create policy "org update admin" on public.orgs for update
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

alter table public.org_members enable row level security;
drop policy if exists "members read" on public.org_members;
create policy "members read" on public.org_members for select using (public.is_org_member(org_id));
-- writes go through SECURITY DEFINER functions; no direct write policy (deny by default)

alter table public.org_invites enable row level security;
drop policy if exists "invites read" on public.org_invites;
create policy "invites read" on public.org_invites for select using (public.is_org_admin(org_id));

-- ── org / membership functions ───────────────────────────────────────────────
create or replace function public.create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.orgs(name, created_by)
    values (coalesce(nullif(p_name, ''), 'My Org'), auth.uid()) returning id into new_id;
  insert into public.org_members(org_id, user_id, role) values (new_id, auth.uid(), 'admin');
  return new_id;
end $$;

create or replace function public.claim_invites()
returns void language plpgsql security definer set search_path = public as $$
declare uemail text;
begin
  select email into uemail from auth.users where id = auth.uid();
  if uemail is null then return; end if;
  insert into public.org_members(org_id, user_id, role)
    select i.org_id, auth.uid(), i.role from public.org_invites i
    where lower(i.email) = lower(uemail)
    on conflict (org_id, user_id) do nothing;
  delete from public.org_invites i where lower(i.email) = lower(uemail);
end $$;

create or replace function public.invite_member(p_org uuid, p_email text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then raise exception 'not an admin'; end if;
  if p_role not in ('admin','member') then p_role := 'member'; end if;
  insert into public.org_invites(org_id, email, role, invited_by)
    values (p_org, lower(p_email), p_role, auth.uid())
    on conflict (org_id, email) do update set role = excluded.role;
end $$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then raise exception 'not an admin'; end if;
  delete from public.org_members where org_id = p_org and user_id = p_user;
end $$;

create or replace function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(p_org) then raise exception 'not an admin'; end if;
  if p_role not in ('admin','member') then return; end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user;
end $$;

create or replace function public.org_members_list(p_org uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.org_members m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and public.is_org_member(p_org)
  order by m.created_at;
$$;

create or replace function public.org_invites_list(p_org uuid)
returns table(email text, role text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select i.email, i.role, i.created_at from public.org_invites i
  where i.org_id = p_org and public.is_org_admin(p_org)
  order by i.created_at;
$$;

-- ── connections: org_id, migrate existing data, org-based RLS ────────────────
alter table public.connections add column if not exists org_id uuid references public.orgs(id) on delete cascade;
alter table public.metric_cache add column if not exists org_id uuid references public.orgs(id) on delete cascade;

do $$
declare r record; new_org uuid;
begin
  for r in (select distinct user_id from public.connections where org_id is null) loop
    insert into public.orgs(name, created_by) values ('My Org', r.user_id) returning id into new_org;
    insert into public.org_members(org_id, user_id, role) values (new_org, r.user_id, 'admin')
      on conflict do nothing;
    update public.connections set org_id = new_org where user_id = r.user_id and org_id is null;
    update public.metric_cache set org_id = new_org where user_id = r.user_id and org_id is null;
  end loop;
end $$;

alter table public.connections drop constraint if exists connections_user_id_source_key;
create unique index if not exists connections_org_source_key on public.connections(org_id, source);

drop policy if exists "own rows" on public.connections;
drop policy if exists "org members read connections" on public.connections;
create policy "org members read connections" on public.connections for select
  using (public.is_org_member(org_id));
drop policy if exists "org admins write connections" on public.connections;
create policy "org admins write connections" on public.connections for all
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists "own cache" on public.metric_cache;
drop policy if exists "cache members read" on public.metric_cache;
create policy "cache members read" on public.metric_cache for select using (public.is_org_member(org_id));
drop policy if exists "cache admins write" on public.metric_cache;
create policy "cache admins write" on public.metric_cache for all
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));
