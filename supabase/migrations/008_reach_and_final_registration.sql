-- =====================================================================
-- AGUK Admin Dashboard — REACH tracking + Final Registration (Phase 7/8)
-- Run in Supabase SQL Editor after 001-007. Purely additive.
--
-- REACH booking-detection mechanism is intentionally NOT automated —
-- the spec is explicit that a Microsoft booking integration must not be
-- invented. "Mark as Booked" / "Mark Attended" are manual AGUK actions
-- from the dashboard. Sending the invitation email is the one automatic
-- step, and even that is triggered by a human clicking "Send REACH
-- Invitation", not fired automatically on completion.
-- =====================================================================

alter table public.students
  add column if not exists reach_status text not null default 'NOT_READY'
    check (reach_status in ('NOT_READY', 'READY', 'INVITATION_SENT', 'BOOKED', 'ATTENDED', 'NOT_ATTENDED')),
  add column if not exists reach_invitation_sent_at timestamptz,
  add column if not exists reach_booking_at timestamptz,
  add column if not exists reach_meeting_at timestamptz,
  add column if not exists reach_attendance_confirmed_at timestamptz,
  add column if not exists reach_attendance_confirmed_by uuid references auth.users(id),
  add column if not exists registration_complete boolean not null default false,
  add column if not exists registration_completed_at timestamptz,
  add column if not exists registration_completed_by uuid references auth.users(id);

-- Extend the existing completeness check to also flip REACH to READY
-- (folded into the same trigger function that already runs on every
-- students update, so there's still only one place doing this sync).
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
  then
    if NEW.next_action is distinct from 'AGUK - Prepare REACH / Meeting' then
      NEW.overall_registration_status := 'REACH Pending';
      NEW.next_action := 'AGUK - Prepare REACH / Meeting';
      NEW.next_action_owner := 'AGUK';
    end if;
    if NEW.reach_status = 'NOT_READY' then
      NEW.reach_status := 'READY';
    end if;
  end if;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------
-- Backfill: students who already had all 4 requirements + payment done
-- BEFORE this migration existed never got a students UPDATE to trigger
-- the logic above (triggers only fire on new writes, not retroactively).
-- Bring them forward to READY now.
-- ---------------------------------------------------------------------
update public.students
set reach_status = 'READY'
where reach_status = 'NOT_READY'
  and agreement_completed
  and conduct_completed
  and medical_completed
  and accommodation_completed
  and payment_status = 'PAYMENT_RECEIVED';
