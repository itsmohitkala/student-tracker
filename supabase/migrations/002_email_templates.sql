-- =====================================================================
-- AGUK Admin Dashboard — Email templates & communications log
-- Run in Supabase SQL Editor after 001_phase1_admin_dashboard.sql.
-- Purely additive. Safe to re-run.
--
-- NOTE: this migration does NOT send email. It gives the dashboard a
-- versioned template library and a communications log that records
-- what *should* be sent (status = 'queued'). Wiring an n8n webhook to
-- actually deliver these is a follow-up step once that webhook exists.
-- =====================================================================

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  subject text not null,
  body text not null,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(student_id),
  template_code text,
  template_version integer,
  recipient text not null,
  subject text not null,
  body text not null,
  sender text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  triggered_by uuid references auth.users(id),
  message_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_log_student_id_idx on public.email_log (student_id);
create index if not exists email_log_created_at_idx on public.email_log (created_at desc);

alter table public.email_templates enable row level security;
alter table public.email_log enable row level security;

-- templates: any dashboard role can read; only administrators manage them
drop policy if exists "email_templates_read" on public.email_templates;
create policy "email_templates_read" on public.email_templates
  for select using (public.current_user_role() is not null);

drop policy if exists "email_templates_admin_write" on public.email_templates;
create policy "email_templates_admin_write" on public.email_templates
  for all using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- communications log: any dashboard role can read; administrator/operational can queue new entries;
-- nobody can edit/delete a logged communication (append-only, same principle as audit_events)
drop policy if exists "email_log_read" on public.email_log;
create policy "email_log_read" on public.email_log
  for select using (public.current_user_role() is not null);

drop policy if exists "email_log_insert" on public.email_log;
create policy "email_log_insert" on public.email_log
  for insert with check (public.current_user_role() in ('administrator', 'operational', 'automation'));

-- ---------------------------------------------------------------------
-- Seed the templates named in the AGUK spec. Bodies use {{merge_field}}
-- placeholders resolved by the dashboard from student data + form input.
-- Only FURTHER_INFO_REQUIRED is wired into the UI today (Request More
-- Information action) — the rest are ready to use once later phases
-- (payment, accommodation, REACH) call them.
-- ---------------------------------------------------------------------
insert into public.email_templates (code, name, subject, body, active) values
  (
    'FURTHER_INFO_REQUIRED',
    'Further Information Required',
    'AGUK Application {{case_id}} — Further Information Required',
    E'Dear {{first_name}},\n\nThank you for your application ({{case_id}}) to AGUK for {{university}}.\n\nBefore we can proceed, we need the following additional information:\n\n{{reason}}\n\nPlease reply to this email with the requested information as soon as possible so we can continue processing your application.\n\nKind regards,\nAcademic Guardians UK',
    true
  ),
  (
    'UNIVERSITY_REGISTRATION_EMAIL',
    'University Registration Email',
    'Welcome to AGUK — Complete Your Registration ({{case_id}})',
    E'Dear {{first_name}},\n\nYour application ({{case_id}}) has been approved and payment has been confirmed.\n\nPlease now complete the following registration forms:\n- University Agreement\n- Student Code of Conduct\n- Medical Form\n- Confirmation of Accommodation Details\n\nKind regards,\nAcademic Guardians UK',
    false
  ),
  (
    'REMINDER_3_DAY',
    '3-Day Outstanding Registration Reminder',
    'Reminder: Outstanding Registration Requirements ({{case_id}})',
    E'Dear {{first_name}},\n\nThis is a reminder that the following registration requirements are still outstanding for {{case_id}}:\n\n{{outstanding_items}}\n\nPlease complete these as soon as possible.\n\nKind regards,\nAcademic Guardians UK',
    false
  ),
  (
    'PRIVATE_ACCOMMODATION_REQUIREMENTS',
    'Private Accommodation Requirements / Document Request',
    'Accommodation Review — Further Documents Required ({{case_id}})',
    E'Dear {{first_name}},\n\nWe are reviewing your private accommodation arrangements for {{case_id}}. Please provide:\n\n{{reason}}\n\nKind regards,\nAcademic Guardians UK',
    false
  ),
  (
    'ALTERNATIVE_ACCOMMODATION_REQUIRED',
    'Alternative Accommodation Required',
    'Accommodation Review — Alternative Arrangements Needed ({{case_id}})',
    E'Dear {{first_name}},\n\nHaving reviewed the accommodation details submitted for {{case_id}}, we are unable to proceed with the current arrangement. Please see the details below:\n\n{{reason}}\n\nKind regards,\nAcademic Guardians UK',
    false
  ),
  (
    'REACH_BOOKING_EMAIL',
    'REACH Booking Email',
    'Book Your REACH Introductory Meeting ({{case_id}})',
    E'Dear {{first_name}},\n\nAll registration requirements for {{case_id}} are now complete. Please book your REACH introductory meeting using the link provided by your AGUK contact.\n\nKind regards,\nAcademic Guardians UK',
    false
  ),
  (
    'TECHNICAL_INTERNAL_NOTIFICATION',
    'Technical / Internal Notification',
    'Automation Alert — {{case_id}}',
    E'An automation issue requires attention for case {{case_id}}:\n\n{{reason}}',
    false
  )
on conflict (code) do nothing;
