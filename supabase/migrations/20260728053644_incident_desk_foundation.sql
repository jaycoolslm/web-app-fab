-- Incident desk foundation: teams, per-user membership, and incidents.
--
-- Tenancy rule enforced here, not in application queries: a signed-in user can
-- only reach rows belonging to a team they are a member of. Every table below
-- has RLS enabled with policies scoped `to authenticated`, and the anon role is
-- granted nothing at all.

-- ---------------------------------------------------------------------------
-- Private schema for helpers that must bypass RLS. It is not listed in
-- `[api] schemas`, so nothing in here is reachable through the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and char_length(name) <= 80),
  created_at timestamptz not null default now()
);

-- Team names are matched case-insensitively so "Northwind NOC" and
-- "northwind noc" are the same team at signup.
create unique index if not exists teams_name_lower_key on public.teams (lower(name));

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members (user_id);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 4000),
  severity text not null check (severity in ('P1', 'P2', 'P3', 'P4')),
  status text not null default 'triage'
    check (status in ('triage', 'investigating', 'mitigating', 'resolved')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_team_id_idx on public.incidents (team_id);
create index if not exists incidents_created_by_idx on public.incidents (created_by);
create index if not exists incidents_team_severity_idx
  on public.incidents (team_id, severity, created_at desc);

-- ---------------------------------------------------------------------------
-- Membership lookup
--
-- security definer so it can read team_members without tripping the RLS policy
-- that is itself defined in terms of this function. It only ever answers about
-- the caller, so it discloses nothing the caller could not already see.
-- ---------------------------------------------------------------------------
create or replace function private.is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_team_member(uuid) from public;
grant execute on function private.is_team_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Signup joins or creates a team
--
-- The team name arrives as signup metadata. There is no invite or approval
-- step by design: naming a team joins it, naming a new one creates it.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_team_id uuid;
begin
  v_team_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'team_name', '')), '');

  -- Signups from flows that carry no team name (fixtures, future SSO) simply
  -- land without a team.
  if v_team_name is null then
    return new;
  end if;

  select t.id into v_team_id
  from public.teams t
  where lower(t.name) = lower(v_team_name);

  if v_team_id is null then
    insert into public.teams (name)
    values (left(v_team_name, 80))
    on conflict (lower(name)) do nothing
    returning id into v_team_id;

    -- Lost the race against a concurrent signup for the same team name.
    if v_team_id is null then
      select t.id into v_team_id
      from public.teams t
      where lower(t.name) = lower(v_team_name);
    end if;
  end if;

  insert into public.team_members (team_id, user_id)
  values (v_team_id, new.id)
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;

drop trigger if exists incidents_touch_updated_at on public.incidents;
create trigger incidents_touch_updated_at
  before update on public.incidents
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.incidents enable row level security;

-- Teams are read-only to members; rows are created by the signup trigger.
drop policy if exists "teams are visible to their members" on public.teams;
create policy "teams are visible to their members"
  on public.teams
  for select
  to authenticated
  using (private.is_team_member(id));

-- Membership rows are readable within your own team; writes go through signup.
drop policy if exists "membership is visible within your team" on public.team_members;
create policy "membership is visible within your team"
  on public.team_members
  for select
  to authenticated
  using (private.is_team_member(team_id));

drop policy if exists "incidents are visible to their team" on public.incidents;
create policy "incidents are visible to their team"
  on public.incidents
  for select
  to authenticated
  using (private.is_team_member(team_id));

drop policy if exists "incidents are raised inside your own team" on public.incidents;
create policy "incidents are raised inside your own team"
  on public.incidents
  for insert
  to authenticated
  with check (
    private.is_team_member(team_id)
    and created_by = (select auth.uid())
  );

-- `using` stops you touching another team's incident; `with check` stops you
-- pushing one of your own across the boundary.
drop policy if exists "incidents are edited inside your own team" on public.incidents;
create policy "incidents are edited inside your own team"
  on public.incidents
  for update
  to authenticated
  using (private.is_team_member(team_id))
  with check (private.is_team_member(team_id));

drop policy if exists "incidents are deleted inside your own team" on public.incidents;
create policy "incidents are deleted inside your own team"
  on public.incidents
  for delete
  to authenticated
  using (private.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- `auto_expose_new_tables` is off, so nothing is reachable without these.
-- anon is deliberately granted nothing: signed-out clients cannot even reach
-- the tables, let alone the rows.
-- ---------------------------------------------------------------------------
grant select on public.teams to authenticated;
grant select on public.team_members to authenticated;
grant select, insert, update, delete on public.incidents to authenticated;
