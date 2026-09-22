import { Card } from './Card'
import { Button } from './Button'
import { StatusPill } from './StatusPill'
import type { FormReviewStatus } from '../types'

export const FORM_STATUS_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  OUTSTANDING: 'neutral',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  INFO_REQUESTED: 'warning',
}

export const FORM_STATUS_LABELS: Record<string, string> = {
  OUTSTANDING: 'Not filled',
  SUBMITTED: 'Awaiting Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  INFO_REQUESTED: 'Info Requested',
}

function isImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(value)
}

function isUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function FieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="text-ink-400">Null</span>
  if (isImageUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded-md border border-ink-200 p-1" style={{ backgroundColor: '#ffffff' }}>
        <img src={value} alt="" className="h-20 w-20 object-contain" />
      </a>
    )
  }
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
        View file
      </a>
    )
  }
  if (typeof value === 'boolean') return <span className="text-ink-900">{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'object') return <span className="text-ink-900">{JSON.stringify(value)}</span>
  return <span className="text-ink-900">{String(value)}</span>
}

export function FormReviewCard({
  title,
  status,
  submittedAt,
  reviewedAt,
  notes,
  fields,
  canAct,
  onDecision,
  submitting,
}: {
  title: string
  status: FormReviewStatus | string
  submittedAt: string | null
  reviewedAt?: string | null
  notes?: string | null
  fields: { label: string; value: unknown }[]
  canAct: boolean
  onDecision: (decision: 'approve' | 'reject' | 'info') => void
  submitting: boolean
}) {
  const canReview = canAct && (status === 'SUBMITTED' || status === 'INFO_REQUESTED')

  return (
    <Card
      title={title}
      action={
        <StatusPill tone={FORM_STATUS_TONES[status] ?? 'neutral'}>{FORM_STATUS_LABELS[status] ?? status}</StatusPill>
      }
    >
      {status === 'OUTSTANDING' ? (
        <p className="text-sm text-ink-400">Not yet submitted.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{f.label}</p>
                <div className="mt-0.5 text-sm">
                  <FieldValue value={f.value} />
                </div>
              </div>
            ))}
            {submittedAt && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Submitted</p>
                <p className="mt-0.5 text-sm text-ink-900">{new Date(submittedAt).toLocaleString('en-GB')}</p>
              </div>
            )}
          </div>

          {notes && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Notes</p>
              <p className="mt-0.5 text-sm text-ink-900">{notes}</p>
            </div>
          )}

          {reviewedAt && (status === 'APPROVED' || status === 'REJECTED') && (
            <p className="text-xs text-ink-400">Reviewed {new Date(reviewedAt).toLocaleString('en-GB')}</p>
          )}

          {canReview && (
            <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
              <Button variant="success" className="h-8 px-3 text-xs" disabled={submitting} onClick={() => onDecision('approve')}>
                Approve
              </Button>
              <Button variant="warning" className="h-8 px-3 text-xs" disabled={submitting} onClick={() => onDecision('info')}>
                Request More Information
              </Button>
              <Button variant="danger" className="h-8 px-3 text-xs" disabled={submitting} onClick={() => onDecision('reject')}>
                Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
