import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { StatusBadge } from '../components/StatusBadge'
import { StatusPill } from '../components/StatusPill'
import { EmptyState, TableSkeleton } from '../components/EmptyState'
import type { Student } from '../types'

const STATUS_FILTERS = [
  'All',
  'Application Submitted',
  'Under Review',
  'Information Requested',
  'Approved',
  'Rejected',
  'Closed',
]

const COLUMN_COUNT = 11

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

function formsProgress(s: Student) {
  const done = [s.agreement_completed, s.conduct_completed, s.medical_completed, s.accommodation_completed].filter(
    Boolean,
  ).length
  return `${done}/4`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysWaiting(value: string | null) {
  if (!value) return '—'
  const created = new Date(value).getTime()
  const diff = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24))
  return diff <= 0 ? 'Today' : `${diff}d`
}

function initials(first: string | null, last: string | null) {
  const a = first?.trim()?.[0] ?? ''
  const b = last?.trim()?.[0] ?? ''
  return (a + b || '?').toUpperCase()
}

export function Applications() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        setError(error.message)
      } else {
        setStudents((data ?? []) as Student[])
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const matchesStatus = statusFilter === 'All' || s.application_status === statusFilter
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        [s.first_name, s.last_name, s.case_id, s.email, s.university]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(q))
      return matchesStatus && matchesSearch
    })
  }, [students, search, statusFilter])

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Applications</h1>
          <p className="mt-1 text-sm text-ink-400">
            Review submitted University U18 applications and progress them to payment.
          </p>
        </div>
        {!loading && !error && (
          <span className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600">
            {students.length} total
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-white p-3 shadow-sm">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="m20 20-3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search name, case ID, email, university…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-80 rounded-md border border-ink-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm text-ink-400">
          {loading ? 'Loading…' : `${filtered.length} result${filtered.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-100">
            <thead className="bg-ink-50/80">
              <tr>
                {['Student', 'Case ID', 'University', 'Course', 'Submitted', 'Status', 'Payment', 'Forms', 'Owner', 'Next Action', 'Waiting'].map(
                  (h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading && <TableSkeleton columns={COLUMN_COUNT} />}
              {!loading && error && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-4 py-10 text-center text-sm text-rose-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT}>
                    <EmptyState
                      title="No applications match your filters"
                      description={
                        students.length === 0
                          ? 'No applications have been submitted yet, or your account has not been granted dashboard access.'
                          : 'Try clearing the search or status filter.'
                      }
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                filtered.map((s) => (
                  <tr key={s.student_id ?? s.case_id ?? s.email} className="transition-colors hover:bg-ink-50/60">
                    <td className="whitespace-nowrap px-4 py-3">
                      {s.student_id ? (
                        <Link to={`/applications/${s.student_id}`} className="group flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700/10 text-xs font-semibold text-brand-700">
                            {initials(s.first_name, s.last_name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900 group-hover:text-brand-700 group-hover:underline">
                              {[s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unnamed'}
                            </p>
                            <p className="text-xs text-ink-400">{s.email ?? '—'}</p>
                          </div>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3" title="This application has no passport number / student ID set — add one in Supabase before it can be opened.">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-600">
                            {initials(s.first_name, s.last_name)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900">
                              {[s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unnamed'}
                            </p>
                            <p className="text-xs font-medium text-rose-600">Missing student ID — cannot open</p>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{s.case_id ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{s.university ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{s.course_title ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{formatDate(s.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusBadge status={s.application_status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <StatusPill tone={PAYMENT_TONES[s.payment_status] ?? 'neutral'}>
                        {PAYMENT_LABELS[s.payment_status] ?? s.payment_status}
                      </StatusPill>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">
                      {s.payment_status === 'PAYMENT_RECEIVED' ? formsProgress(s) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">
                      {s.next_action_owner ?? 'Admin'}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-600">{s.next_action ?? 'Review Application'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">{daysWaiting(s.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
