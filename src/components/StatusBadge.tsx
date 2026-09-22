const STATUS_STYLES: Record<string, string> = {
  'Application Submitted': 'bg-ink-100 text-ink-700 ring-ink-200',
  'Under Review': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Information Requested': 'bg-amber-50 text-amber-700 ring-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  Closed: 'bg-ink-100 text-ink-500 ring-ink-200',
}

const STATUS_DOTS: Record<string, string> = {
  'Application Submitted': 'bg-ink-400',
  'Under Review': 'bg-amber-500',
  'Information Requested': 'bg-amber-500',
  Approved: 'bg-emerald-500',
  Rejected: 'bg-rose-500',
  Closed: 'bg-ink-400',
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-ink-100 text-ink-700 ring-ink-200'
  const dot = STATUS_DOTS[status] ?? 'bg-ink-400'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
}
