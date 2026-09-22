-- =====================================================================
-- AGUK Admin Dashboard — Payment gate (Phase 2)
-- Run in Supabase SQL Editor after 001 and 002. Purely additive.
-- =====================================================================

alter table public.students
  add column if not exists payment_status text not null default 'NOT_REQUIRED'
    check (payment_status in ('NOT_REQUIRED', 'AWAITING_PAYMENT', 'PAYMENT_RECEIVED', 'PAYMENT_ISSUE')),
  add column if not exists payment_received_at timestamptz,
  add column if not exists payment_recorded_by uuid references auth.users(id),
  add column if not exists payment_notes text;

comment on column public.students.payment_status is
  'NOT_REQUIRED (before approval) -> AWAITING_PAYMENT (set on application approval) -> PAYMENT_RECEIVED (manual AGUK confirmation) or PAYMENT_ISSUE';

-- Backfill: any student already Approved should be shown as awaiting payment
-- rather than "not required", since that column did not exist before now.
update public.students
set payment_status = 'AWAITING_PAYMENT'
where application_status = 'Approved' and payment_status = 'NOT_REQUIRED';
