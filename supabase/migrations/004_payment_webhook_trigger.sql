-- =====================================================================
-- AGUK Admin Dashboard — Payment-received webhook trigger
-- Run in Supabase SQL Editor. Purely additive.
--
-- Fires the n8n "Payment Confirmation & Onboarding Kickoff" workflow
-- exactly once when a student's payment_status transitions INTO
-- 'PAYMENT_RECEIVED' — not on every unrelated update to the row.
-- =====================================================================

-- pg_net lets Postgres make outbound HTTP calls from a trigger.
-- Supabase projects usually have this available already; this is a
-- no-op if it's already enabled.
create extension if not exists pg_net;

create or replace function public.notify_payment_received()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.payment_status = 'PAYMENT_RECEIVED'
     and OLD.payment_status is distinct from NEW.payment_status then
    perform net.http_post(
      url := 'https://aguk.app.n8n.cloud/webhook-test/51ad4110-a97b-4394-b3ea-15a7667dee3e',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'students',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_payment_received on public.students;

create trigger trg_notify_payment_received
after update on public.students
for each row
execute function public.notify_payment_received();
