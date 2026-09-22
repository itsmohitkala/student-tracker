-- =====================================================================
-- AGUK Admin Dashboard — Phase 1 migration (run once, top to bottom)
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Purely additive: no existing tables, columns, or data are dropped
-- or renamed. Safe to re-run (uses IF NOT EXISTS / OR REPLACE / DROP+CREATE POLICY).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New columns on students: dashboard status/ownership fields
--    (application_status already exists and keeps its current values
--    — 'Application Submitted' etc — written by the existing n8n flow)
-- ---------------------------------------------------------------------
alter table public.students
  add column if not exists overall_registration_status text not null default 'In Progress',
  add column if not exists next_action text,
  add column if not exists next_action_owner text,
  add column if not exists application_decision_reason text,
  add column if not exists application_reviewed_by uuid references auth.users(id),
  add column if not exists application_reviewed_at timestamptz;

comment on column public.students.overall_registration_status is
  'High-level family/AGUK-facing status: In Progress, Awaiting Family, Awaiting AGUK, REACH Pending, Internal Onboarding, Registration Complete, Closed / Withdrawn';

-- ---------------------------------------------------------------------
-- 2. profiles + user_roles (Supabase Auth users -> AGUK dashboard roles)
--    One role per user (administrator / operational / read_only / automation).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('administrator', 'operational', 'read_only', 'automation')),
  created_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id)
);

-- Helper: current user's role, bypassing RLS recursion (security definer)
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------------
-- 3. audit_events (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id),
  actor_user_id uuid references auth.users(id),
  actor_role text,
  action text not null,
  entity_type text,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_student_id_idx on public.audit_events (student_id);
create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);

-- ---------------------------------------------------------------------
-- 4. RLS: enable (idempotent) on new tables + policies everywhere
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;

-- profiles: a user can read/update their own profile; any dashboard role can read all
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id or public.current_user_role() is not null);

drop policy if exists "profiles_self_upsert" on public.profiles;
create policy "profiles_self_upsert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- user_roles: any authenticated dashboard user can read roles (needed for UI);
-- only administrators can grant/revoke roles directly against the table.
-- (The app instead calls the set_user_role()/list_dashboard_users() RPCs below,
-- which enforce the same rule and also give admins visibility of auth.users.)
drop policy if exists "user_roles_read" on public.user_roles;
create policy "user_roles_read" on public.user_roles
  for select using (auth.uid() = user_id or public.current_user_role() is not null);

drop policy if exists "user_roles_admin_write" on public.user_roles;
create policy "user_roles_admin_write" on public.user_roles
  for all using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- audit_events: any dashboard role can read; administrator/operational can insert; nobody updates/deletes (append-only)
drop policy if exists "audit_events_read" on public.audit_events;
create policy "audit_events_read" on public.audit_events
  for select using (public.current_user_role() is not null);

drop policy if exists "audit_events_insert" on public.audit_events;
create policy "audit_events_insert" on public.audit_events
  for insert with check (public.current_user_role() in ('administrator', 'operational', 'automation'));

-- students: readable by any dashboard role; writable by administrator/operational only
drop policy if exists "students_dashboard_read" on public.students;
create policy "students_dashboard_read" on public.students
  for select using (public.current_user_role() is not null);

drop policy if exists "students_dashboard_write" on public.students;
create policy "students_dashboard_write" on public.students
  for update using (public.current_user_role() in ('administrator', 'operational'))
  with check (public.current_user_role() in ('administrator', 'operational'));

-- related form/record tables: read-only for any dashboard role (writes stay with n8n via service role)
do $$
declare
  t text;
begin
  for t in select unnest(array['parents','application_form','agreement_form','conduct_form','medical_form','accommodation_form','documents'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%I_dashboard_read" on public.%I', t, t);
    execute format(
      'create policy "%I_dashboard_read" on public.%I for select using (public.current_user_role() is not null)',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Admin-only RPCs used by the Users & Roles page
-- ---------------------------------------------------------------------

-- List every Supabase Auth user alongside their dashboard role (if any).
-- Only callable by administrators; reads auth.users via SECURITY DEFINER
-- since normal RLS-scoped roles cannot see the auth schema directly.
create or replace function public.list_dashboard_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  role text,
  full_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can list dashboard users';
  end if;

  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at, r.role, p.full_name
    from auth.users u
    left join public.user_roles r on r.user_id = u.id
    left join public.profiles p on p.id = u.id
    order by u.created_at desc;
end;
$$;

-- Assign (or change) a dashboard role for an existing Supabase Auth user.
-- Only callable by administrators.
create or replace function public.set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can assign roles';
  end if;

  if p_role not in ('administrator', 'operational', 'read_only', 'automation') then
    raise exception 'Invalid role: %', p_role;
  end if;

  insert into public.user_roles (user_id, role, assigned_by)
  values (p_user_id, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, assigned_by = excluded.assigned_by;
end;
$$;

-- Remove a user's dashboard role (revokes dashboard access without deleting the auth user).
create or replace function public.revoke_user_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can revoke roles';
  end if;

  delete from public.user_roles where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Bootstrap: make dev7@gmail.com an administrator
-- ---------------------------------------------------------------------
insert into public.user_roles (user_id, role)
select id, 'administrator' from auth.users where email = 'dev7@gmail.com'
on conflict (user_id) do update set role = 'administrator';
