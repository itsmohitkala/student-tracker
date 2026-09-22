type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_STYLES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  neutral: 'bg-ink-100 text-ink-500 ring-ink-200',
  info: 'bg-brand-700/10 text-brand-700 ring-brand-700/20',
}

export function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  )
}
