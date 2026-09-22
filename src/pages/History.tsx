import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { roleLabel } from '../lib/roles'
import { StatusPill } from '../components/StatusPill'
import { EmptyState, TableSkeleton } from '../components/EmptyState'

interface ActionRow {
  kind: 'action'
  id: string
  student_id: string | null
  actor_role: string | null
  action: string
  reason: string | null
  previous_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
  students: { case_id: string | null; first_name: string | null; last_name: string | null } | null
}

interface EmailRow {
  kind: 'email'
  id: string
  student_id: string | null
  recipient: string
  subject: string
  body: string | null
  status: 'queued' | 'sent' | 'failed'
  template_code: string | null
  template_version: number | null
  created_at: string
  students: { case_id: string | null; first_name: string | null; last_name: string | null } | null
}

type HistoryRow = ActionRow | EmailRow

const PAGE_SIZE = 50

const EMAIL_STATUS_TONE = { queued: 'warning', sent: 'success', failed: 'danger' } as const

export function History() {
  const [actionRows, setActionRows] = useState<ActionRow[]>([])
  const [emailRows, setEmailRows] = useState<EmailRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  async function fetchPage(offset: number) {
    const [actionsRes, emailsRes] = await Promise.all([
      supabase
        .from('audit_events')
        .select(
          'id, student_id, actor_role, action, reason, previous_value, new_value, created_at, students(case_id, first_name, last_name)',
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
      supabase
        .from('email_log')
        .select(
          'id, student_id, recipient, subject, body, status, template_code, template_version, created_at, students(case_id, first_name, last_name)',
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1),
    ])
    return { actionsRes, emailsRes }
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { actionsRes, emailsRes } = await fetchPage(0)
    if (actionsRes.error) setError(actionsRes.error.message)
    else if (emailsRes.error) setError(emailsRes.error.message)
    else {
      const actions = (actionsRes.data ?? []).map((r) => ({ ...r, kind: 'action' as const })) as unknown as ActionRow[]
      const emails = (emailsRes.data ?? []).map((r) => ({ ...r, kind: 'email' as const })) as unknown as EmailRow[]
      setActionRows(actions)
      setEmailRows(emails)
      setHasMore(actions.length === PAGE_SIZE || emails.length === PAGE_SIZE)
    }
    setLoading(false)
  }

  async function loadMore() {
    setLoadingMore(true)
    const { actionsRes, emailsRes } = await fetchPage(Math.max(actionRows.length, emailRows.length))
    if (!actionsRes.error && actionsRes.data) {
      const next = actionsRes.data.map((r) => ({ ...r, kind: 'action' as const })) as unknown as ActionRow[]
      setActionRows((prev) => [...prev, ...next])
    }
    if (!emailsRes.error && emailsRes.data) {
      const next = emailsRes.data.map((r) => ({ ...r, kind: 'email' as const })) as unknown as EmailRow[]
      setEmailRows((prev) => [...prev, ...next])
    }
    setHasMore((actionsRes.data?.length ?? 0) === PAGE_SIZE || (emailsRes.data?.length ?? 0) === PAGE_SIZE)
    setLoadingMore(false)
  }

  useEffect(() => {
    load()
  }, [])

  const merged = useMemo<HistoryRow[]>(() => {
    return [...actionRows, ...emailRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [actionRows, emailRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return merged
    return merged.filter((r) => {
      const name = [r.students?.first_name, r.students?.last_name].filter(Boolean).join(' ')
      const searchable =
        r.kind === 'action' ? `${r.action} ${r.reason ?? ''}` : `${r.subject} ${r.recipient} ${r.template_code ?? ''}`
      return (
        searchable.toLowerCase().includes(q) ||
        (r.students?.case_id ?? '').toLowerCase().includes(q) ||
        name.toLowerCase().includes(q)
      )
    })
  }, [merged, search])

  return (
    <div className="mx-auto max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">History</h1>
        <p className="mt-1 text-sm text-ink-400">
          Every manual decision, automated action and communication across all students, most recent first.
        </p>
      </div>

      <div className="mt-4">
        <input
          type="text"
          placeholder="Search action, email subject, case ID, student name, reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-96 rounded-md border border-ink-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-ink-100">
            <thead className="bg-ink-50/80">
              <tr>
                {['When', 'Student', 'Type', 'Detail', 'Role / Status', 'Reason'].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading && <TableSkeleton columns={6} />}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-rose-600">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="No history yet"
                      description="Actions and communications across all students will show up here."
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                filtered.map((r) => {
                  const key = `${r.kind}-${r.id}`
                  const expanded = expandedKey === key
                  const hasDetail =
                    r.kind === 'email'
                      ? Boolean(r.body)
                      : Boolean(r.reason || r.previous_value || r.new_value)
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => hasDetail && setExpandedKey(expanded ? null : key)}
                        className={`hover:bg-ink-50/60 ${hasDetail ? 'cursor-pointer' : ''}`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-600">
                          <div className="flex items-center gap-1.5">
                            {hasDetail && (
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className={`h-3 w-3 shrink-0 text-ink-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
                              >
                                <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                            {new Date(r.created_at).toLocaleString('en-GB')}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {r.student_id ? (
                            <Link
                              to={`/applications/${r.student_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-brand-700 hover:underline"
                            >
                              {r.students?.case_id ??
                                ([r.students?.first_name, r.students?.last_name].filter(Boolean).join(' ') ||
                                  'Student')}
                            </Link>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusPill tone={r.kind === 'email' ? 'info' : 'neutral'}>
                            {r.kind === 'email' ? 'Email' : 'Action'}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-ink-900">
                          {r.kind === 'action' ? r.action.replaceAll('_', ' ') : r.subject}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {r.kind === 'action' ? (
                            <span className="text-ink-600">{roleLabel(r.actor_role)}</span>
                          ) : (
                            <StatusPill tone={EMAIL_STATUS_TONE[r.status]}>{r.status}</StatusPill>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-ink-600">
                          {r.kind === 'action' ? (r.reason ?? '—') : `To ${r.recipient}`}
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${key}-detail`} className="bg-ink-50/60">
                          <td colSpan={6} className="px-4 py-4 text-sm">
                            {r.kind === 'email' ? (
                              <div className="space-y-2">
                                {r.template_code && (
                                  <p className="text-xs text-ink-400">
                                    Template: {r.template_code}
                                    {r.template_version != null ? ` · v${r.template_version}` : ''}
                                  </p>
                                )}
                                <p className="whitespace-pre-line leading-relaxed text-ink-700">
                                  {r.body || 'No body recorded.'}
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {r.reason && <p className="text-ink-700">{r.reason}</p>}
                                {(r.previous_value || r.new_value) && (
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {r.previous_value && (
                                      <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                                          Before
                                        </p>
                                        <pre className="mt-1 overflow-x-auto rounded-md bg-white p-2 text-xs text-ink-600">
                                          {JSON.stringify(r.previous_value, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {r.new_value && (
                                      <div>
                                        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                                          After
                                        </p>
                                        <pre className="mt-1 overflow-x-auto rounded-md bg-white p-2 text-xs text-ink-600">
                                          {JSON.stringify(r.new_value, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && !error && hasMore && !search && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-md border border-ink-200 px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
