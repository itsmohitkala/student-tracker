import { FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

export function Login() {
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [resetSent, setResetSent] = useState(false)

  if (!loading && session) {
    return <Navigate to="/applications" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setSubmitting(false)
      if (error) setError(error.message)
      else setResetSent(true)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) setError(error.message)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-ink-100 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold tracking-tight text-ink-900">AGUK Admin</p>
        <h1 className="mt-1 text-lg font-semibold text-ink-900">
          {mode === 'signin' ? 'Sign in' : 'Reset your password'}
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          {mode === 'signin' ? 'Internal staff access only.' : "We'll email you a link to set a new password."}
        </p>

        {resetSent ? (
          <div className="mt-6 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            If an account exists for {email}, a password reset link has been sent.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            {mode === 'signin' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-ink-700">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            )}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
            </button>
          </form>
        )}

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'forgot' : 'signin')
            setError(null)
            setResetSent(false)
          }}
          className="mt-4 text-sm text-brand-700 hover:underline"
        >
          {mode === 'signin' ? 'Forgot password?' : 'Back to sign in'}
        </button>
      </div>
    </div>
  )
}
