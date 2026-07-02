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
    <div className={`rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? 'text-pink-300' : 'text-zinc-100'}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
