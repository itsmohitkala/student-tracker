-- =====================================================================
-- AGUK Admin Dashboard — stop the REACH-pending trigger from firing
-- forever. Run in Supabase SQL Editor after 001-013.
--
-- Bug found during full end-to-end testing: check_registration_requirements_complete()
-- (from 008_reach_and_final_registration.sql) re-forces
-- overall_registration_status = 'REACH Pending' and next_action back to
-- 'AGUK - Prepare REACH / Meeting' on EVERY update to a student's row,
-- as long as all 4 forms + payment are done — with no check for
-- whether REACH was already attended or registration already
-- completed. So any edit to a fully-registered student (even an
-- unrelated field) silently reverts their status back to "REACH
-- Pending" in the Applications/All Students lists, even though the
-- detail page's Registration Progress tracker (driven by different
-- fields) correctly still shows everything complete.
--
-- Confirmed live: manually corrected student 7777's
-- overall_registration_status to 'Registration Complete', reloaded
-- All Students, and watched it silently revert back to 'REACH Pending'
-- moments later after an unrelated update touched the row.
--
-- Fix: only force that transition the FIRST time it happens (reach_status
-- is still its default 'NOT_READY' and registration isn't already
-- complete) — never again after that.
-- =====================================================================

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
     and NEW.reach_status = 'NOT_READY'
     and not NEW.registration_complete
  then
    NEW.overall_registration_status := 'REACH Pending';
    NEW.next_action := 'AGUK - Prepare REACH / Meeting';
    NEW.next_action_owner := 'AGUK';
    NEW.reach_status := 'READY';
  end if;
  return NEW;
end;
$$;
