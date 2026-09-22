-- =====================================================================
-- AGUK Admin Dashboard — fix student_id type mismatch
-- Run in Supabase SQL Editor after 001-009. THIS IS THE ONLY FILE YOU
-- NEED TO RUN — it has not been applied yet as of 2026-09-17, confirmed
-- live: email_log, documents, audit_events and medical_form all still
-- reject a passport-number student_id like "1111" with
-- "invalid input syntax for type uuid".
--
-- Root cause: students.student_id was changed from uuid to text (to
-- hold passport numbers), but:
--   1. documents, email_log, audit_events, medical_form were never
--      converted along with it — they're still uuid columns, which
--      can't hold "1111" or foreign-key to a text column.
--   2. students.student_id itself lost its unique constraint somewhere
--      in that process, so nothing can even foreign-key to it yet.
--
-- This one file fixes both, in order, then refreshes PostgREST's
-- schema cache so the fix is visible immediately with no restart.
-- =====================================================================

-- 1. students.student_id needs a unique constraint before anything can
--    foreign-key to it. Idempotent — skipped if it's already there.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass
      and contype in ('p', 'u')
      and conkey = (
        select array_agg(attnum) from pg_attribute
        where attrelid = 'public.students'::regclass and attname = 'student_id'
      )
  ) then
    alter table public.students add constraint students_student_id_key unique (student_id);
  end if;
end $$;

-- 2. Convert the 4 lagging tables from uuid to text and re-attach the FK.
do $$
declare
  t text;
begin
  for t in select unnest(array['documents', 'email_log', 'audit_events', 'medical_form'])
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_student_id_fkey');
    execute format('alter table public.%I alter column student_id type text using student_id::text', t);
    execute format(
      'alter table public.%I add constraint %I foreign key (student_id) references public.students(student_id)',
      t, t || '_student_id_fkey'
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
