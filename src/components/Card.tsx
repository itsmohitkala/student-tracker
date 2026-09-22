import { ReactNode } from 'react'

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-ink-100 bg-white p-6 shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {action}
        </div>
      )}
      <div className={title ? 'mt-4' : undefined}>{children}</div>
    </section>
  )
}
