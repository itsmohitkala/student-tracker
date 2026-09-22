-- =====================================================================
-- AGUK Admin Dashboard — Registration forms + accommodation tracking
-- Run in Supabase SQL Editor after 001-004. Purely additive.
--
-- Agreement / Conduct / Medical: reuse the existing agreement_completed /
-- conduct_completed / medical_completed booleans on students — no new
-- columns needed. One shared trigger function flips the right boolean
-- to true the moment n8n inserts into the matching form table.
--
-- Accommodation is the one case needing more than true/false, because
-- of the three routes:
--   - UNIVERSITY: auto-approved, no manual review
--   - PRIVATE / PBSA: AGUK must manually review before it's cleared
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Agreement / Conduct / Medical — one function, three triggers
-- ---------------------------------------------------------------------
create or replace function public.mark_form_complete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_column text;
begin
  v_column := case TG_TABLE_NAME
    when 'agreement_form' then 'agreement_completed'
    when 'conduct_form' then 'conduct_completed'
    when 'medical_form' then 'medical_completed'
  end;
  execute format('update public.students set %I = true where student_id = $1', v_column) using NEW.student_id;
  return NEW;
end;
$$;

drop trigger if exists trg_agreement_complete on public.agreement_form;
create trigger trg_agreement_complete after insert on public.agreement_form
  for each row execute function public.mark_form_complete();

drop trigger if exists trg_conduct_complete on public.conduct_form;
create trigger trg_conduct_complete after insert on public.conduct_form
  for each row execute function public.mark_form_complete();

drop trigger if exists trg_medical_complete on public.medical_form;
create trigger trg_medical_complete after insert on public.medical_form
  for each row execute function public.mark_form_complete();

-- ---------------------------------------------------------------------
-- 2. Accommodation route + review columns
-- ---------------------------------------------------------------------
alter table public.students
  add column if not exists accommodation_route text
    check (accommodation_route in ('UNIVERSITY', 'PRIVATE', 'PBSA')),
  add column if not exists accommodation_status text not null default 'OUTSTANDING'
    check (accommodation_status in ('OUTSTANDING', 'REQUIRES_REVIEW', 'CLEARED_TO_PROCEED', 'COMPLETE')),
  add column if not exists accommodation_reviewed_by uuid references auth.users(id),
  add column if not exists accommodation_reviewed_at timestamptz,
  add column if not exists accommodation_notes text,
  add column if not exists outlook_folder_created boolean not null default false,
  add column if not exists outlook_folder_created_at timestamptz;

-- Detect route, set status, keep accommodation_completed in sync so the
-- 4-form checklist can just read one boolean per form like the others.
--
-- Notifying the student (e.g. "further information required" for
-- Private/PBSA) is handled from the dashboard when AGUK actually makes
-- that call — not automatically here — so this trigger only classifies
-- the route and sets status. No outbound webhook call.
create or replace function public.handle_accommodation_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_route text;
  v_status text;
begin
  v_route := case
    when NEW.accommodation_type ilike '%university%' then 'UNIVERSITY'
    when NEW.accommodation_type ilike '%pbsa%' then 'PBSA'
    when NEW.accommodation_type ilike '%private%' then 'PRIVATE'
    else null
  end;

  v_status := case when v_route = 'UNIVERSITY' then 'COMPLETE' else 'REQUIRES_REVIEW' end;

  update public.students
  set accommodation_route = v_route,
      accommodation_status = v_status,
      accommodation_completed = (v_status = 'COMPLETE')
  where student_id = NEW.student_id;

  return NEW;
end;
$$;

drop trigger if exists trg_accommodation_submitted on public.accommodation_form;
create trigger trg_accommodation_submitted after insert on public.accommodation_form
  for each row execute function public.handle_accommodation_submission();

-- Keep accommodation_completed in sync when an admin later clears a
-- PRIVATE/PBSA case to proceed via the dashboard.
create or replace function public.sync_accommodation_completed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.accommodation_completed := NEW.accommodation_status in ('COMPLETE', 'CLEARED_TO_PROCEED');
  return NEW;
end;
$$;

drop trigger if exists trg_sync_accommodation_completed on public.students;
create trigger trg_sync_accommodation_completed
  before update of accommodation_status on public.students
  for each row execute function public.sync_accommodation_completed();

-- ---------------------------------------------------------------------
-- 3. When all 4 requirements are done, move next_action to REACH prep.
-- ---------------------------------------------------------------------
create or replace function public.check_registration_requirements_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

drop trigger if exists trg_check_registration_complete on public.students;
create trigger trg_check_registration_complete
  before update on public.students
  for each row execute function public.check_registration_requirements_complete();
