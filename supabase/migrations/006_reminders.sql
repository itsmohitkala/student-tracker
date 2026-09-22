-- =====================================================================
-- AGUK Admin Dashboard — 3-day outstanding-forms reminders
-- Run in Supabase SQL Editor after 001-005. Purely additive.
--
-- Manual "Send Reminder" (from the dashboard) and the automatic 3-day
-- backend reminder both write to the SAME tracking columns, so a
-- manual send resets the 3-day clock and the two never double up.
-- =====================================================================

alter table public.students
  add column if not exists last_reminder_sent_at timestamptz,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists next_reminder_at timestamptz;

-- ---------------------------------------------------------------------
-- Reusable: which of the 4 requirements are still outstanding, as text.
-- ---------------------------------------------------------------------
create or replace function public.outstanding_requirements(p_student public.students)
returns text
language sql
stable
as $$
  select nullif(
    concat_ws(', ',
      case when not p_student.agreement_completed then 'University Agreement' end,
      case when not p_student.conduct_completed then 'Student Code of Conduct' end,
      case when not p_student.medical_completed then 'Medical Form' end,
      case when not p_student.accommodation_completed then 'Confirmation of Accommodation Details' end
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------
-- Send the 3-day reminder to every student who:
--   - has paid (payment_status = 'PAYMENT_RECEIVED')
--   - has at least one outstanding requirement
--   - has never been reminded, or their last reminder was 3+ days ago
--
-- IMPORTANT: replace the placeholder URL with your real communication
-- webhook if it differs from the one already used for Request More
-- Information / Compose Email.
-- ---------------------------------------------------------------------
create or replace function public.send_outstanding_forms_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student record;
  v_outstanding text;
  v_subject text;
  v_body text;
  v_sent_count integer := 0;
begin
  for v_student in
    select * from public.students
    where payment_status = 'PAYMENT_RECEIVED'
      and (last_reminder_sent_at is null or last_reminder_sent_at <= now() - interval '3 days')
      and not (agreement_completed and conduct_completed and medical_completed and accommodation_completed)
      and email is not null
  loop
    v_outstanding := public.outstanding_requirements(v_student);
    continue when v_outstanding is null;

    v_subject := format('Reminder: Outstanding Registration Requirements (%s)', coalesce(v_student.case_id, ''));
    v_body := format(
      E'Dear %s,\n\nThis is a reminder that the following registration requirements are still outstanding for %s:\n\n%s\n\nPlease complete these as soon as possible.\n\nKind regards,\nAcademic Guardians UK',
      coalesce(v_student.first_name, ''),
      coalesce(v_student.case_id, ''),
      v_outstanding
    );

    perform net.http_post(
      url := 'https://aguk.app.n8n.cloud/webhook-test/f0708384-efdc-4383-b972-24f35eb0db27',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'to', v_student.email,
        'subject', v_subject,
        'body', v_body,
        'student_id', v_student.student_id,
        'case_id', v_student.case_id,
        'template_code', 'REMINDER_3_DAY',
        'template_version', null
      )
    );

    insert into public.email_log (student_id, template_code, recipient, subject, body, status, sent_at, metadata)
    values (v_student.student_id, 'REMINDER_3_DAY', v_student.email, v_subject, v_body, 'sent', now(),
            jsonb_build_object('source', 'automatic_3_day_reminder'));

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

-- ---------------------------------------------------------------------
-- Schedule it to run daily. Requires the pg_cron extension — if this
-- errors, enable "pg_cron" under Database > Extensions in the
-- Supabase Dashboard first, then re-run just this block.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

do $job$
begin
  if not exists (select 1 from cron.job where jobname = 'send-outstanding-forms-reminders') then
    perform cron.schedule(
      'send-outstanding-forms-reminders',
      '0 9 * * *', -- 09:00 UTC daily
      $sql$select public.send_outstanding_forms_reminders();$sql$
    );
  end if;
end;
$job$;
