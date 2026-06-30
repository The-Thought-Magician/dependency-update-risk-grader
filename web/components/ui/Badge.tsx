import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'lime' | 'amber' | 'red' | 'blue' | 'green'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  neutral: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  lime: 'bg-lime-400/15 text-lime-300 border-lime-500/30',
  amber: 'bg-amber-400/15 text-amber-300 border-amber-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
}

export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

// Maps a letter grade (A-F) to a colored badge for supply-chain risk display.
export function GradeBadge({ grade, className = '' }: { grade?: string | null; className?: string }) {
  const g = (grade ?? '?').toUpperCase()
  const tone: Tone =
    g === 'A' ? 'green' : g === 'B' ? 'lime' : g === 'C' ? 'amber' : g === 'D' ? 'amber' : g === 'F' ? 'red' : 'neutral'
  return (
    <Badge tone={tone} className={`font-bold ${className}`}>
      {g}
    </Badge>
  )
}

export default Badge
