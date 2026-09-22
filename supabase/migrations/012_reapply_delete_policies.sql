-- =====================================================================
-- AGUK Admin Dashboard — re-apply DELETE RLS policies
-- Run in Supabase SQL Editor after 001-011.
--
-- Found during end-to-end testing: "Delete Application" reports
-- success (no error thrown) but the student row and its children are
-- NOT actually removed. Root cause: when RLS is enabled on a table but
-- no DELETE policy exists for the caller's role, Postgres does not
-- raise an error — it silently deletes 0 rows and returns success.
-- PostgREST then reports 200 OK with no rows affected, which the
-- frontend correctly treats as "no error" and shows a false success
-- toast.
--
-- This means migration 009_delete_and_realtime.sql — which defines
-- exactly these policies — was very likely never actually run against
-- this database, the same way 010 wasn't for a long time. This file
-- re-applies the same DELETE policies; it's a exact duplicate of what
-- 009 already defines, safe to run whether or not 009 ran previously
-- (drop-if-exists then re-create).
-- =====================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'parents', 'application_form', 'agreement_form', 'conduct_form',
    'medical_form', 'accommodation_form', 'documents', 'audit_events', 'email_log'
  ])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%I_admin_delete" on public.%I', t, t);
    execute format(
      'create policy "%I_admin_delete" on public.%I for delete using (public.current_user_role() = ''administrator'')',
      t, t
    );
  end loop;
end $$;

alter table public.students enable row level security;
drop policy if exists "students_admin_delete" on public.students;
create policy "students_admin_delete" on public.students
  for delete using (public.current_user_role() = 'administrator');

notify pgrst, 'reload schema';
