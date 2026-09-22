-- =====================================================================
-- AGUK Admin Dashboard — let admin_delete_user() actually work
-- Run in Supabase SQL Editor after 001-017.
--
-- Bug found live: deleting a user failed with
--   "update or delete on table users violates foreign key constraint
--    students_application_reviewed_by_fkey"
--
-- Every "who reviewed/recorded/triggered this" column (application_
-- reviewed_by, payment_recorded_by, agreement/conduct/medical/
-- accommodation_reviewed_by, reach_attendance_confirmed_by,
-- registration_completed_by, audit_events.actor_user_id,
-- email_log.triggered_by, email_templates.created_by,
-- user_roles.assigned_by) references auth.users(id) with no ON DELETE
-- behavior — Postgres's default blocks the delete outright. Since any
-- real admin/operational account will have reviewed *something*, this
-- made it impossible to ever delete a staff account that had done any
-- work, which is essentially all of them.
--
-- Fix: ON DELETE SET NULL on all of these — NOT cascade. The audit
-- trail itself (audit_events rows, reason/previous_value/new_value,
-- timestamps, review notes) is untouched; only the "which staff
-- account did this" pointer clears to null once that account is gone.
-- This preserves history while allowing accounts to actually be
-- deleted. (profiles.id and user_roles.user_id stay ON DELETE CASCADE
-- as before — those should disappear with the account.)
-- =====================================================================

do $$
declare
  t text;
  c text;
  pair text;
begin
  foreach pair in array array[
    'students.application_reviewed_by',
    'students.payment_recorded_by',
    'students.agreement_reviewed_by',
    'students.conduct_reviewed_by',
    'students.medical_reviewed_by',
    'students.accommodation_reviewed_by',
    'students.reach_attendance_confirmed_by',
    'students.registration_completed_by',
    'audit_events.actor_user_id',
    'email_log.triggered_by',
    'email_templates.created_by',
    'user_roles.assigned_by'
  ]
  loop
    t := split_part(pair, '.', 1);
    c := split_part(pair, '.', 2);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_' || c || '_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      t, t || '_' || c || '_fkey', c
    );
  end loop;
end $$;
