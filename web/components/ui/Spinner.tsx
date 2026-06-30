export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-lime-400 ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-neutral-500">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export default Spinner
