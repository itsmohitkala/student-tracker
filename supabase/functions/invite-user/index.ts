// Edge Function: invite-user
// Deploy via Supabase Dashboard > Edge Functions > Create a new function
// (name it "invite-user", paste this file's contents, click Deploy).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the platform — do not hardcode secrets here.
//
// Called by the admin dashboard's Users page. Verifies the caller is an
// administrator (via their own JWT, respecting RLS), then uses the
// service-role client — which never reaches the browser — to invite the
// new user by email and assign their dashboard role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    const { email, role, fullName } = await req.json()
    if (!email || !role) {
      return json({ error: 'email and role are required' }, 400)
    }
    const allowedRoles = ['administrator', 'operational', 'read_only', 'automation']
    if (!allowedRoles.includes(role)) {
      return json({ error: `Invalid role: ${role}` }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Client scoped to the caller's own JWT — used only to verify their role.
    const callerClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: 'Invalid session' }, 401)
    }

    const { data: roleRow, error: roleError } = await callerClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (roleError || roleRow?.role !== 'administrator') {
      return json({ error: 'Only administrators can invite users' }, 403)
    }

    // Privileged admin client — service role key never leaves this function.
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : undefined,
    })
    if (inviteError || !invited.user) {
      return json({ error: inviteError?.message ?? 'Failed to invite user' }, 400)
    }

    const { error: roleAssignError } = await adminClient
      .from('user_roles')
      .upsert({ user_id: invited.user.id, role, assigned_by: userData.user.id }, { onConflict: 'user_id' })
    if (roleAssignError) {
      return json({ error: `User invited but role assignment failed: ${roleAssignError.message}` }, 500)
    }

    if (fullName) {
      await adminClient.from('profiles').upsert({ id: invited.user.id, email, full_name: fullName })
    }

    return json({ user_id: invited.user.id, email }, 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
