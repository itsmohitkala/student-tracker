-- =====================================================================
-- AGUK Admin Dashboard — create dashboard users directly (no email
-- invite flow, no Edge Function deploy needed).
-- Run in Supabase SQL Editor after 001-015. Then see the one-time
-- Vault setup note at the bottom (run separately, not saved to a file).
--
-- Simplified per request: the administrator sets a username, password
-- and role directly on the website — no invite email, no dependency on
-- Supabase's SMTP being configured, no separate step for the new
-- person to click a link and set their own password.
--
-- This calls the same GoTrue admin endpoint (POST /auth/v1/admin/users)
-- used earlier in this session to create the 3 test accounts via curl
-- — already proven to work reliably on this project. The `http`
-- extension makes that call synchronously from Postgres so we get the
-- new user's id back immediately to assign their role.
-- =====================================================================

create extension if not exists http with schema extensions;

create or replace function public.admin_create_user(p_email text, p_password text, p_role text, p_full_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_service_key text;
  v_response extensions.http_response;
  v_body jsonb;
  v_new_user_id uuid;
  v_error text;
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can create users';
  end if;

  if p_role not in ('administrator', 'operational', 'read_only', 'automation') then
    raise exception 'Invalid role: %', p_role;
  end if;

  if p_email is null or p_email = '' then
    raise exception 'Email is required';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise exception 'service_role_key is not set in Vault — see the note at the bottom of migration 016';
  end if;

  select * into v_response from extensions.http((
    'POST',
    'https://opkylkdwhawtctjhdgfg.supabase.co/auth/v1/admin/users',
    array[
      extensions.http_header('apikey', v_service_key),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    jsonb_build_object(
      'email', p_email,
      'password', p_password,
      'email_confirm', true,
      'user_metadata', case when p_full_name is not null then jsonb_build_object('full_name', p_full_name) else '{}'::jsonb end
    )::text
  )::extensions.http_request);

  v_body := v_response.content::jsonb;
  v_new_user_id := (v_body->>'id')::uuid;

  if v_new_user_id is null then
    v_error := coalesce(v_body->>'msg', v_body->>'error_description', v_body->>'error', v_body->>'error_code', v_response.content);
    raise exception 'Failed to create user: %', v_error;
  end if;

  insert into public.user_roles (user_id, role, assigned_by)
  values (v_new_user_id, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role, assigned_by = excluded.assigned_by;

  if p_full_name is not null then
    insert into public.profiles (id, email, full_name)
    values (v_new_user_id, p_email, p_full_name)
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  end if;

  return jsonb_build_object('user_id', v_new_user_id, 'email', p_email);
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text) to authenticated;

-- =====================================================================
-- ONE-TIME SETUP — if you haven't already run this in your SQL Editor
-- session, run it now (separately from the block above, and don't
-- save it into any file that gets committed to git):
--
--   select vault.create_secret(
--     '<your project service_role key>',
--     'service_role_key',
--     'Used by admin_create_user() to call the GoTrue admin API'
--   );
--
-- Find it: Supabase Dashboard > Project Settings > API > service_role.
-- Already have it set from the invite-flow attempt? No need to run it
-- again — this function reads the same secret.
-- =====================================================================
