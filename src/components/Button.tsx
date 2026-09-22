import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost'

const VARIANT_STYLES: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-600 disabled:opacity-60',
  secondary: 'border border-ink-200 text-ink-600 hover:bg-ink-50 hover:border-ink-300 disabled:opacity-60',
  danger: 'border border-rose-300 text-rose-600 hover:bg-rose-50 disabled:opacity-60',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60',
  warning: 'bg-amber-500 text-white hover:bg-amber-400 disabled:opacity-60',
  ghost: 'text-brand-700 hover:underline',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  fullWidth?: boolean
}

export function Button({ variant = 'primary', fullWidth, className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors ${
        fullWidth ? 'w-full' : ''
      } ${VARIANT_STYLES[variant]} ${className}`}
    />
  )
}
