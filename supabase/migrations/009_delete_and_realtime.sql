-- =====================================================================
-- AGUK Admin Dashboard — Permanent delete (admin-only) + realtime for
-- the notification bar. Run in Supabase SQL Editor after 001-008.
-- Purely additive (new RLS policies + a publication membership change).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DELETE policies — administrator only, on students and every table
--    that references it, so a full application purge doesn't hit FK
--    violations or silently leave orphaned rows.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'parents', 'application_form', 'agreement_form', 'conduct_form',
    'medical_form', 'accommodation_form', 'documents', 'audit_events', 'email_log'
  ])
  loop
    execute format('drop policy if exists "%I_admin_delete" on public.%I', t, t);
    execute format(
      'create policy "%I_admin_delete" on public.%I for delete using (public.current_user_role() = ''administrator'')',
      t, t
    );
  end loop;
end $$;

drop policy if exists "students_admin_delete" on public.students;
create policy "students_admin_delete" on public.students
  for delete using (public.current_user_role() = 'administrator');

-- ---------------------------------------------------------------------
-- 2. Realtime — add students to the realtime publication so the
--    dashboard's notification bell can subscribe to new-application
--    INSERTs. Safe to re-run (ignores "already a member" errors).
-- ---------------------------------------------------------------------
do $$
begin
  execute 'alter publication supabase_realtime add table public.students';
exception when duplicate_object then
  null;
end $$;
