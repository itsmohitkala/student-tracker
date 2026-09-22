-- =====================================================================
-- AGUK Admin Dashboard — let administrators fully delete a dashboard
-- user (not just revoke their role).
-- Run in Supabase SQL Editor after 001-016 (needs the http extension
-- and the service_role_key Vault secret 016 already set up).
--
-- "Revoke access" already existed but only removes the user_roles row
-- — the auth account itself stays around. This adds a real delete,
-- same admin-only pattern as everything else on this page: calls
-- GoTrue's admin DELETE endpoint synchronously via the http extension.
-- user_roles/profiles rows are ON DELETE CASCADE against auth.users,
-- so they clean up automatically once the auth user is gone.
-- =====================================================================

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_service_key text;
  v_response extensions.http_response;
  v_body jsonb;
  v_error text;
begin
  if public.current_user_role() <> 'administrator' then
    raise exception 'Only administrators can delete users';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise exception 'service_role_key is not set in Vault — see migration 016';
  end if;

  select * into v_response from extensions.http((
    'DELETE',
    'https://opkylkdwhawtctjhdgfg.supabase.co/auth/v1/admin/users/' || p_user_id::text,
    array[
      extensions.http_header('apikey', v_service_key),
      extensions.http_header('Authorization', 'Bearer ' || v_service_key)
    ],
    null,
    null
  )::extensions.http_request);

  if v_response.status not in (200, 204) then
    begin
      v_body := v_response.content::jsonb;
      v_error := coalesce(v_body->>'msg', v_body->>'error_description', v_body->>'error', v_response.content);
    exception when others then
      v_error := v_response.content;
    end;
    raise exception 'Failed to delete user: %', v_error;
  end if;

  -- Belt-and-braces: the cascade should already have done this, but
  -- clean up explicitly in case the auth-side delete raced with it.
  delete from public.user_roles where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;
