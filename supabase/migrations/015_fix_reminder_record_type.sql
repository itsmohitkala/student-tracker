-- =====================================================================
-- AGUK Admin Dashboard — fix send_outstanding_forms_reminders() type bug
-- Run in Supabase SQL Editor after 001-014.
--
-- Bug found while test-firing the reminder function for the first time
-- against a real eligible row (payment received, no forms filled):
--   ERROR: cannot cast type record to students
--
-- v_student was declared as a generic `record`, but
-- outstanding_requirements(p_student public.students) expects the
-- actual `students` composite type — Postgres can't implicitly cast a
-- generic record to a named composite type. This bug has existed since
-- the original 006_reminders.sql; it was never caught before because
-- no test run ever had a row that actually matched the eligibility
-- WHERE clause, so the loop body (and this cast) never executed.
--
-- Fix: type v_student as public.students explicitly.
-- =====================================================================

create or replace function public.send_outstanding_forms_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_outstanding text;
  v_subject text;
  v_body text;
  v_sent_count integer := 0;
  v_recipient_email text;
  v_recipient_name text;
begin
  for v_student in
    select * from public.students
    where payment_status = 'PAYMENT_RECEIVED'
      and (last_reminder_sent_at is null or last_reminder_sent_at <= now() - interval '3 days')
      and not (agreement_completed and conduct_completed and medical_completed and accommodation_completed)
  loop
    v_outstanding := public.outstanding_requirements(v_student);
    continue when v_outstanding is null;

    v_subject := format('Reminder: Outstanding Registration Requirements (%s)', coalesce(v_student.case_id, ''));

    for v_recipient_email, v_recipient_name in
      select v_student.email, v_student.first_name
      where v_student.email is not null
      union all
      select p.email, p.first_name from public.parents p
      where p.student_id = v_student.student_id and p.email is not null
    loop
      v_body := format(
        E'Dear %s,\n\nThis is a reminder that the following registration requirements are still outstanding for %s:\n\n%s\n\nPlease complete these as soon as possible.\n\nKind regards,\nAcademic Guardians UK',
        coalesce(v_recipient_name, ''),
        coalesce(v_student.case_id, ''),
        v_outstanding
      );

      perform net.http_post(
        url := 'https://aguk.app.n8n.cloud/webhook/f0708384-efdc-4383-b972-24f35eb0db27',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'to', v_recipient_email,
          'subject', v_subject,
          'body', v_body,
          'student_id', v_student.student_id,
          'case_id', v_student.case_id,
          'template_code', 'REMINDER_3_DAY',
          'template_version', null
        )
      );

      insert into public.email_log (student_id, template_code, recipient, subject, body, status, sent_at, metadata)
      values (v_student.student_id, 'REMINDER_3_DAY', v_recipient_email, v_subject, v_body, 'sent', now(),
              jsonb_build_object('source', 'automatic_3_day_reminder'));
    end loop;

    insert into public.audit_events (student_id, action, entity_type, entity_id, reason, metadata)
    values (v_student.student_id, 'REMINDER_SENT', 'students', v_student.student_id, v_outstanding,
            jsonb_build_object('source', 'automatic_3_day_reminder'));

    update public.students
    set last_reminder_sent_at = now(),
        reminder_count = reminder_count + 1,
        next_reminder_at = now() + interval '3 days'
    where student_id = v_student.student_id;

    v_sent_count := v_sent_count + 1;
  end loop;

  return v_sent_count;
end;
$$;
