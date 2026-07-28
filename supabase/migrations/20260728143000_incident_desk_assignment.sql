-- Incident desk assignment, and the activity trail behind it.
--
-- Three things arrive here:
--
--   * `public.profiles` — a name to put on an assignment or a trail entry.
--     Readable only to people who share a team with you.
--   * `incidents.assignee_id` — constrained by a *composite* foreign key into
--     `team_members`, so "assign only within the incident's own team" is a
--     declarative rule the database enforces rather than a check the UI makes.
--   * `public.incident_events` — an append-only trail written by a trigger on
--     `incidents`, so every status or assignment change is recorded no matter
--     which code path made it (board drag, detail page, or raw SQL through the
--     Data API).

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (btrim(display_name) <> '' and char_length(display_name) <= 120),
  email text,
  created_at timestamptz not null default now()
);

-- The name we show for a person. Signup metadata wins; failing that, the local
-- part of their email, which is at least recognisable to their own team.
create or replace function private.derive_display_name(p_meta jsonb, p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    coalesce(
      nullif(btrim(coalesce(
        p_meta ->> 'display_name',
        p_meta ->> 'full_name',
        p_meta ->> 'name',
        ''
      )), ''),
      nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
      'Someone'
    ),
    120
  );
$$;

revoke all on function private.derive_display_name(jsonb, text) from public;

-- The name to print for a user id, or null if there is nobody to print. Used by
-- the activity trigger, which needs it while RLS is in force on profiles.
create or replace function private.display_name_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name from public.profiles p where p.id = p_user_id;
$$;

revoke all on function private.display_name_of(uuid) from public;

-- Does the caller share a team with this user? The only question profiles RLS
-- needs answered, and it discloses nothing the caller cannot already see by
-- reading `team_members`.
create or replace function private.shares_team(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id = (select auth.uid())
    or exists (
      select 1
      from public.team_members mine
      join public.team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = p_user_id
    );
$$;

revoke all on function private.shares_team(uuid) from public;
grant execute on function private.shares_team(uuid) to authenticated;

-- Signup now writes a profile as well as joining a team. Replacing the
-- foundation's version rather than adding a second trigger keeps one insert
-- ordering: profile first, so anything that resolves a name can find one.
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
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    private.derive_display_name(new.raw_user_meta_data, new.email),
    new.email
  )
  on conflict (id) do nothing;

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

-- Accounts that existed before this migration still need a name.
insert into public.profiles (id, display_name, email)
select u.id, private.derive_display_name(u.raw_user_meta_data, u.email), u.email
from auth.users u
on conflict (id) do nothing;

alter table public.profiles enable row level security;

-- Read-only, and only within your own team. Rows are written by the signup
-- trigger, so there is no insert, update or delete policy to write.
drop policy if exists "profiles are visible to teammates" on public.profiles;
create policy "profiles are visible to teammates"
  on public.profiles
  for select
  to authenticated
  using (private.shares_team(id));

-- ---------------------------------------------------------------------------
-- Who is on my team
--
-- security_invoker, so the underlying policies on team_members and profiles
-- are what limit the rows — the view is a convenience, not a privilege.
-- ---------------------------------------------------------------------------
create or replace view public.team_directory
with (security_invoker = on) as
select
  tm.team_id,
  tm.user_id,
  p.display_name,
  p.email,
  tm.created_at as joined_at
from public.team_members tm
join public.profiles p on p.id = tm.user_id;

-- ---------------------------------------------------------------------------
-- Assignment
--
-- The composite foreign key is the whole tenancy story for assignment: an
-- incident's (team_id, assignee_id) pair has to exist in team_members, so
-- naming somebody on another team fails on the constraint, not on a policy we
-- remembered to write. A null assignee_id satisfies it (MATCH SIMPLE), which is
-- exactly what "unassigned" should mean.
--
-- Removing somebody from a team nulls their assignments rather than deleting
-- the incidents they were holding.
-- ---------------------------------------------------------------------------
alter table public.incidents add column if not exists assignee_id uuid;

alter table public.incidents drop constraint if exists incidents_assignee_on_team_fkey;
alter table public.incidents add constraint incidents_assignee_on_team_fkey
  foreign key (team_id, assignee_id)
  references public.team_members (team_id, user_id)
  on update cascade
  on delete set null (assignee_id);

create index if not exists incidents_team_assignee_idx
  on public.incidents (team_id, assignee_id);

-- ---------------------------------------------------------------------------
-- Activity trail
--
-- Names are captured alongside ids: a trail entry says what was true when it
-- was written, and stays readable after the person it names leaves.
-- `seq` gives a total order, which `created_at` cannot — a status change and an
-- assignment change made in one statement share a timestamp to the microsecond.
--
-- The three person columns are deliberately *not* foreign keys into auth.users.
-- A trail entry is a historical fact, and deleting an account should not rewrite
-- who did what — which is precisely what `on delete set null` would do. Nothing
-- joins on them either, since the names are already here; the ids are kept for
-- "was this me?" comparisons and nothing else.
-- ---------------------------------------------------------------------------
create table if not exists public.incident_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  incident_id uuid not null references public.incidents (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null check (kind in ('raised', 'status_changed', 'assignment_changed')),
  actor_id uuid,
  actor_name text not null,
  from_status text check (from_status in ('triage', 'investigating', 'mitigating', 'resolved')),
  to_status text check (to_status in ('triage', 'investigating', 'mitigating', 'resolved')),
  from_assignee_id uuid,
  from_assignee_name text,
  to_assignee_id uuid,
  to_assignee_name text,
  created_at timestamptz not null default now(),
  constraint incident_events_shape check (
    case kind
      when 'raised' then to_status is not null
      when 'status_changed' then
        from_status is not null and to_status is not null and from_status <> to_status
      when 'assignment_changed' then
        from_assignee_id is distinct from to_assignee_id
      else false
    end
  )
);

create index if not exists incident_events_incident_idx
  on public.incident_events (incident_id, seq desc);
create index if not exists incident_events_team_idx
  on public.incident_events (team_id);

-- Written by the database, not by the application. A board drag, the detail
-- page's picker and a hand-rolled PATCH against the Data API all go through the
-- same `update` on `incidents`, so all three leave the same trail.
create or replace function private.log_incident_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text := coalesce(private.display_name_of((select auth.uid())), 'Someone');
begin
  if tg_op = 'INSERT' then
    insert into public.incident_events (
      incident_id, team_id, kind, actor_id, actor_name, to_status,
      to_assignee_id, to_assignee_name
    )
    values (
      new.id, new.team_id, 'raised', v_actor, v_actor_name, new.status,
      new.assignee_id, private.display_name_of(new.assignee_id)
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.incident_events (
      incident_id, team_id, kind, actor_id, actor_name, from_status, to_status
    )
    values (
      new.id, new.team_id, 'status_changed', v_actor, v_actor_name,
      old.status, new.status
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.incident_events (
      incident_id, team_id, kind, actor_id, actor_name,
      from_assignee_id, from_assignee_name, to_assignee_id, to_assignee_name
    )
    values (
      new.id, new.team_id, 'assignment_changed', v_actor, v_actor_name,
      old.assignee_id, private.display_name_of(old.assignee_id),
      new.assignee_id, private.display_name_of(new.assignee_id)
    );
  end if;

  return null;
end;
$$;

revoke all on function private.log_incident_activity() from public;

drop trigger if exists incidents_log_activity on public.incidents;
create trigger incidents_log_activity
  after insert or update on public.incidents
  for each row execute function private.log_incident_activity();

-- Incidents raised before the trail existed get one entry so their history does
-- not start blank. Best effort: the status recorded is the one it has now.
insert into public.incident_events (
  incident_id, team_id, kind, actor_id, actor_name, to_status, created_at
)
select
  i.id,
  i.team_id,
  'raised',
  i.created_by,
  coalesce(p.display_name, 'Someone'),
  i.status,
  i.created_at
from public.incidents i
left join public.profiles p on p.id = i.created_by
where not exists (
  select 1 from public.incident_events e where e.incident_id = i.id
);

alter table public.incident_events enable row level security;

-- Select only. There is deliberately no insert, update or delete policy: the
-- trail is append-only, and the only thing that appends to it is the trigger
-- above.
drop policy if exists "activity is visible to the incident's team" on public.incident_events;
create policy "activity is visible to the incident's team"
  on public.incident_events
  for select
  to authenticated
  using (private.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- Data API grants
--
-- anon still gets nothing anywhere. `authenticated` gets read on the new
-- tables, plus update on the one assignment column — the insert/update/delete
-- on incident_events is revoked explicitly so a future `grant all` cannot
-- quietly make the trail editable.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant select on public.team_directory to authenticated;
grant select on public.incident_events to authenticated;
revoke insert, update, delete on public.incident_events from authenticated;
