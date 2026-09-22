import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ASSIGNABLE_ROLES, ROLE_LABELS, roleLabel } from '../lib/roles'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState, TableSkeleton } from '../components/EmptyState'
import type { DashboardRole } from '../types'

function initials(text: string | null | undefined) {
  if (!text) return '?'
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : text.slice(0, 2)
  return letters.toUpperCase()
}

interface DashboardUser {
  user_id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  role: DashboardRole | null
  full_name: string | null
}

export function Users() {
  const { role: myRole } = useAuth()
  const [users, setUsers] = useState<DashboardUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviteRole, setInviteRole] = useState<DashboardRole>('read_only')
  const [inviting, setInviting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('list_dashboard_users')
    if (error) setError(error.message)
    else setUsers((data ?? []) as DashboardUser[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function changeRole(userId: string, role: DashboardRole) {
    setSavingUserId(userId)
    const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role })
    setSavingUserId(null)
    if (error) {
      setToast({ kind: 'error', message: error.message })
    } else {
      setToast({ kind: 'success', message: 'Role updated.' })
      load()
    }
  }

  async function revoke(userId: string) {
    setSavingUserId(userId)
    const { error } = await supabase.rpc('revoke_user_role', { p_user_id: userId })
    setSavingUserId(null)
    if (error) {
      setToast({ kind: 'error', message: error.message })
    } else {
      setToast({ kind: 'success', message: 'Access revoked.' })
      load()
    }
  }

  async function deleteUser(userId: string, email: string) {
    if (!window.confirm(`Permanently delete ${email}? This removes their account entirely — they will no longer be able to sign in. This cannot be undone.`)) {
      return
    }
    setSavingUserId(userId)
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId })
    setSavingUserId(null)
    if (error) {
      setToast({ kind: 'error', message: error.message })
    } else {
      setToast({ kind: 'success', message: `${email} deleted.` })
      load()
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      const { error } = await supabase.rpc('admin_create_user', {
        p_email: inviteEmail,
        p_password: invitePassword,
        p_role: inviteRole,
        p_full_name: inviteName || null,
      })
      if (error) throw new Error(error.message)
      setToast({ kind: 'success', message: `${inviteEmail} can now sign in with the password you set.` })
      setInviteEmail('')
      setInviteName('')
      setInvitePassword('')
      setInviteRole('read_only')
      load()
    } catch (e) {
      setToast({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to create user' })
    } finally {
      setInviting(false)
    }
  }

  if (myRole !== 'administrator') {
    return <p className="text-sm text-rose-600">Only administrators can manage users and roles.</p>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Users & Roles</h1>
      <p className="mt-1 text-sm text-ink-400">
        Create AGUK staff accounts and control what they can do in the dashboard.
      </p>

      {toast && (
        <div
          className={`mt-4 rounded-md px-4 py-3 text-sm ${
            toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      <Card title="Create a new user" className="mt-6">
        <form onSubmit={handleInvite} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">Full name</label>
            <input
              type="text"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as DashboardRole)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">Password</label>
            <input
              type="text"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={invitePassword}
              onChange={(e) => setInvitePassword(e.target.value)}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={inviting}>
              {inviting ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-ink-400">
          Share this email and password with them directly — they can sign in immediately and change their
          password later if they want to.
        </p>
      </Card>

      <section className="mt-6 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-ink-100">
          <thead className="bg-ink-50/80">
            <tr>
              {['User', 'Role', 'Last Sign In', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {loading && <TableSkeleton columns={4} />}
            {!loading && error && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-rose-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && users.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="No users yet" description="Create your first AGUK staff account above." />
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              users.map((u) => (
                <tr key={u.user_id} className="transition-colors hover:bg-ink-50/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                        {initials(u.full_name || u.email)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-900">{u.full_name || u.email}</p>
                        <p className="text-xs text-ink-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role ?? ''}
                      disabled={savingUserId === u.user_id}
                      onChange={(e) => changeRole(u.user_id, e.target.value as DashboardRole)}
                      className="rounded-md border border-ink-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="" disabled>
                        {roleLabel(u.role)}
                      </option>
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('en-GB') : 'Never'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      {u.role && (
                        <button
                          onClick={() => revoke(u.user_id)}
                          disabled={savingUserId === u.user_id}
                          className="text-sm font-medium text-amber-600 hover:underline disabled:opacity-60"
                        >
                          Revoke access
                        </button>
                      )}
                      <button
                        onClick={() => deleteUser(u.user_id, u.email)}
                        disabled={savingUserId === u.user_id}
                        className="text-sm font-medium text-rose-600 hover:underline disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
