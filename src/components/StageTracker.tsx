type StageState = 'complete' | 'current' | 'waiting' | 'attention'

interface Stage {
  label: string
  detail: string
  state: StageState
}

const STATE_STYLES: Record<StageState, { dot: string; label: string; line: string }> = {
  complete: { dot: 'bg-emerald-500', label: 'text-ink-900', line: 'bg-emerald-500' },
  current: { dot: 'bg-brand-600', label: 'text-ink-900', line: 'bg-ink-200' },
  attention: { dot: 'bg-amber-500', label: 'text-ink-900', line: 'bg-ink-200' },
  waiting: { dot: 'bg-ink-200', label: 'text-ink-400', line: 'bg-ink-200' },
}

export function StageTracker({ stages }: { stages: Stage[] }) {
  return (
    <ol className="flex flex-col">
      {stages.map((stage, i) => {
        const style = STATE_STYLES[stage.state]
        const isLast = i === stages.length - 1
        return (
          <li key={stage.label} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast && (
              <span className={`absolute left-[7px] top-4 h-full w-px ${style.line}`} aria-hidden />
            )}
            <span className={`z-10 mt-1 h-4 w-4 shrink-0 rounded-full ring-4 ring-white ${style.dot}`} />
            <div>
              <p className={`text-sm font-medium ${style.label}`}>{stage.label}</p>
              <p className="text-xs text-ink-400">{stage.detail}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
