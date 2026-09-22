import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { EmptyState, TableSkeleton } from '../components/EmptyState'
import { StatusPill } from '../components/StatusPill'
import type { Student } from '../types'

interface RecentAction {
  action: string
  created_at: string
}

const PAGE_SIZE = 20

const PROCESS_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  'In Progress': 'info',
  'Awaiting Family': 'warning',
  'Awaiting AGUK': 'warning',
  'REACH Pending': 'info',
  'Internal Onboarding': 'info',
  'Registration Complete': 'success',
  'Closed / Withdrawn': 'danger',
}

const PAYMENT_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  NOT_REQUIRED: 'neutral',
  AWAITING_PAYMENT: 'warning',
  PAYMENT_RECEIVED: 'success',
  PAYMENT_ISSUE: 'danger',
}

const PAYMENT_LABELS: Record<string, string> = {
  NOT_REQUIRED: 'Not Required',
  AWAITING_PAYMENT: 'Awaiting Payment',
  PAYMENT_RECEIVED: 'Received',
  PAYMENT_ISSUE: 'Issue',
}

const REACH_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  NOT_READY: 'neutral',
  READY: 'info',
  INVITATION_SENT: 'warning',
  BOOKED: 'warning',
  ATTENDED: 'success',
  NOT_ATTENDED: 'danger',
}

function initials(first: string | null, last: string | null) {
  const a = first?.trim()?.[0] ?? ''
  const b = last?.trim()?.[0] ?? ''
  return (a + b || '?').toUpperCase()
}

const AVATAR_TONES = [
  'bg-brand-700/10 text-brand-700',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
]

function avatarTone(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

function formsCompletedCount(s: Student) {
  return [s.agreement_completed, s.conduct_completed, s.medical_completed, s.accommodation_completed].filter(
    Boolean,
  ).length
}

function daysWaitingValue(value: string) {
  return Math.floor((Date.now() - new Date(value).getTime()) / (1000 * 60 * 60 * 24))
}

function daysWaitingLabel(days: number) {
  return days <= 0 ? 'Today' : `${days}d`
}

export function AllStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [recentActions, setRecentActions] = useState<Record<string, RecentAction>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data, error, count } = await supabase
        .from('students')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (cancelled) return

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      const rows = (data ?? []) as Student[]
      setStudents(rows)
      setTotalCount(count ?? 0)

      const ids = rows.map((s) => s.student_id)
      if (ids.length > 0) {
        const { data: events } = await supabase
          .from('audit_events')
          .select('student_id, action, created_at')
          .in('student_id', ids)
          .order('created_at', { ascending: false })
          .limit(500)

        if (!cancelled) {
          const latest: Record<string, RecentAction> = {}
          for (const e of (events ?? []) as { student_id: string | null; action: string; created_at: string }[]) {
            if (e.student_id && !latest[e.student_id]) {
              latest[e.student_id] = { action: e.action, created_at: e.created_at }
            }
          }
          setRecentActions(latest)
        }
      } else {
        setRecentActions({})
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [page])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) =>
      [s.first_name, s.last_name, s.case_id, s.email, s.university]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    )
  }, [students, search])

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">All Students</h1>
          <p className="mt-1 text-sm text-ink-400">
            Every student in the system — payment, forms, accommodation and REACH at a glance, plus the last
            thing that happened on their case.
          </p>
        </div>
        {!loading && !error && (
          <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-semibold tabular-nums text-ink-600">
            {totalCount} total
          </span>
        )}
      </div>

      <div className="mb-4">
        <div className="relative w-96 max-w-full">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="M17 17l-4-4" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search this page — name, case ID, email, university…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-100">
            <thead className="bg-ink-50/80">
              <tr>
                {[
                  'Student',
                  'Case ID',
                  'Current Process',
                  'Payment',
                  'Forms',
                  'REACH',
                  'Next Action',
                  'Owner',
                  'Waiting',
                  'Most Recent Action',
                ].map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 z-10 whitespace-nowrap bg-ink-50/95 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400 backdrop-blur"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading && <TableSkeleton columns={10} />}
              {!loading && error && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-rose-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="No students match"
                      description={students.length === 0 ? 'Students will appear here once applications start coming in.' : 'Try clearing the search.'}
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                filtered.map((s) => {
                  const recent = recentActions[s.student_id]
                  const done = formsCompletedCount(s)
                  const waitingDays = daysWaitingValue(s.created_at)
                  return (
                    <tr key={s.student_id} className="group/row transition-colors hover:bg-ink-50/60">
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link to={`/applications/${s.student_id}`} className="group flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(s.student_id)}`}
                          >
                            {initials(s.first_name, s.last_name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900 group-hover:text-brand-700 group-hover:underline">
                              {[s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unnamed'}
                            </p>
                            <p className="text-xs text-ink-400">{s.university || s.email || '—'}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{s.case_id ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusPill tone={PROCESS_TONES[s.overall_registration_status] ?? 'neutral'}>
                          {s.overall_registration_status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusPill tone={PAYMENT_TONES[s.payment_status] ?? 'neutral'}>
                          {PAYMENT_LABELS[s.payment_status] ?? s.payment_status}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {s.payment_status === 'PAYMENT_RECEIVED' ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex gap-0.5">
                              {[0, 1, 2, 3].map((i) => (
                                <span
                                  key={i}
                                  className={`h-1.5 w-3.5 rounded-full ${i < done ? 'bg-emerald-500' : 'bg-ink-100'}`}
                                />
                              ))}
                            </div>
                            <span className="text-xs tabular-nums text-ink-500">{done}/4</span>
                          </div>
                        ) : (
                          <span className="text-sm text-ink-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {s.reach_status && s.reach_status !== 'NOT_READY' ? (
                          <StatusPill tone={REACH_TONES[s.reach_status] ?? 'neutral'}>
                            {s.reach_status.replaceAll('_', ' ')}
                          </StatusPill>
                        ) : (
                          <span className="text-sm text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-600">{s.next_action ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{s.next_action_owner ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                            waitingDays >= 7
                              ? 'bg-rose-50 text-rose-600'
                              : waitingDays >= 3
                                ? 'bg-amber-50 text-amber-700'
                                : 'text-ink-500'
                          }`}
                        >
                          {daysWaitingLabel(waitingDays)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {recent ? (
                          <>
                            <p className="font-medium text-ink-900">{recent.action.replaceAll('_', ' ')}</p>
                            <p className="text-xs text-ink-400">{new Date(recent.created_at).toLocaleString('en-GB')}</p>
                          </>
                        ) : (
                          <span className="text-ink-400">No actions yet</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !error && totalCount > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-ink-400">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
