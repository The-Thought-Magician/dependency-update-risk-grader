import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/40 px-6 py-12 text-center ${className}`}
    >
      {icon != null && <div className="mb-3 text-3xl text-neutral-600">{icon}</div>}
      <h3 className="text-base font-semibold text-neutral-200">{title}</h3>
      {description != null && <p className="mt-1 max-w-md text-sm text-neutral-500">{description}</p>}
      {action != null && <div className="mt-4">{action}</div>}
    </div>
  )
}

export default EmptyState
