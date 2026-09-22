-- =====================================================================
-- AGUK Admin Dashboard — Approve/Reject/Request-Info per form
-- Run in Supabase SQL Editor after 001-006. Purely additive.
--
-- Agreement / Conduct / Medical move from "auto-complete on submit" to
-- a real review gate: submitting sets SUBMITTED (awaiting AGUK review),
-- and an admin/operational user then Approves, Rejects, or Requests
-- Info from the dashboard — same pattern already used for Accommodation.
-- =====================================================================

alter table public.students
  add column if not exists agreement_review_status text not null default 'OUTSTANDING'
    check (agreement_review_status in ('OUTSTANDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INFO_REQUESTED')),
  add column if not exists conduct_review_status text not null default 'OUTSTANDING'
    check (conduct_review_status in ('OUTSTANDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INFO_REQUESTED')),
  add column if not exists medical_review_status text not null default 'OUTSTANDING'
    check (medical_review_status in ('OUTSTANDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'INFO_REQUESTED')),
  add column if not exists agreement_reviewed_by uuid references auth.users(id),
  add column if not exists agreement_reviewed_at timestamptz,
  add column if not exists agreement_notes text,
  add column if not exists conduct_reviewed_by uuid references auth.users(id),
  add column if not exists conduct_reviewed_at timestamptz,
  add column if not exists conduct_notes text,
  add column if not exists medical_reviewed_by uuid references auth.users(id),
  add column if not exists medical_reviewed_at timestamptz,
  add column if not exists medical_notes text;

-- Submitting the form now sets SUBMITTED (awaiting review), not completed.
create or replace function public.mark_form_complete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_column text;
begin
  v_column := case TG_TABLE_NAME
    when 'agreement_form' then 'agreement_review_status'
    when 'conduct_form' then 'conduct_review_status'
    when 'medical_form' then 'medical_review_status'
  end;
  execute format('update public.students set %I = ''SUBMITTED'' where student_id = $1', v_column) using NEW.student_id;
  return NEW;
end;
$$;

-- Consolidate ALL completed-boolean syncing (agreement/conduct/medical
-- from review_status, accommodation from accommodation_status) into the
-- same BEFORE UPDATE trigger that checks overall completeness, so there
-- is only one trigger touching these columns and no ordering ambiguity
-- between separate triggers.
create or replace function public.check_registration_requirements_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.agreement_completed := (NEW.agreement_review_status = 'APPROVED');
  NEW.conduct_completed := (NEW.conduct_review_status = 'APPROVED');
  NEW.medical_completed := (NEW.medical_review_status = 'APPROVED');
  NEW.accommodation_completed := (NEW.accommodation_status in ('COMPLETE', 'CLEARED_TO_PROCEED'));

  if NEW.agreement_completed
     and NEW.conduct_completed
     and NEW.medical_completed
     and NEW.accommodation_completed
     and NEW.payment_status = 'PAYMENT_RECEIVED'
     and NEW.next_action is distinct from 'AGUK - Prepare REACH / Meeting'
  then
    NEW.overall_registration_status := 'REACH Pending';
    NEW.next_action := 'AGUK - Prepare REACH / Meeting';
    NEW.next_action_owner := 'AGUK';
  end if;
  return NEW;
end;
$$;

-- The old dedicated accommodation-sync trigger is now redundant (folded
-- into the function above) — drop it to avoid two triggers racing on
-- the same columns.
drop trigger if exists trg_sync_accommodation_completed on public.students;

-- ---------------------------------------------------------------------
-- Backfill: forms that were already auto-completed under the OLD rule
-- (submission = instantly complete, before this migration existed)
-- carry that over as APPROVED rather than showing as OUTSTANDING/"not
-- yet submitted" now that review is a real gate. Anything not already
-- completed is untouched (stays OUTSTANDING, correctly awaiting
-- submission — or SUBMITTED, correctly awaiting review, once the
-- triggers above start firing on new submissions).
-- ---------------------------------------------------------------------
update public.students
set agreement_review_status = case when agreement_completed then 'APPROVED' else agreement_review_status end,
    conduct_review_status = case when conduct_completed then 'APPROVED' else conduct_review_status end,
    medical_review_status = case when medical_completed then 'APPROVED' else medical_review_status end
where agreement_completed or conduct_completed or medical_completed;
