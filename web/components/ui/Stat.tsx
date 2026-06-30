import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  accent?: boolean
  className?: string
}

export function Stat({ label, value, hint, accent = false, className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-lime-300' : 'text-neutral-100'}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </div>
  )
}

export default Stat
