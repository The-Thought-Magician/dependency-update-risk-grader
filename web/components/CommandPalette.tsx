'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

export type CommandRoute = { label: string; href: string; section: string }

export const ROUTES: CommandRoute[] = [
  { label: 'Dashboard', href: '/dashboard', section: 'Overview' },
  { label: 'Update Queue', href: '/dashboard/queue', section: 'Triage' },
  { label: 'Updates', href: '/dashboard/updates', section: 'Triage' },
  { label: 'Projects', href: '/dashboard/projects', section: 'Inventory' },
  { label: 'Packages', href: '/dashboard/packages', section: 'Inventory' },
  { label: 'Maintainers', href: '/dashboard/maintainers', section: 'Inventory' },
  { label: 'Policies', href: '/dashboard/policies', section: 'Governance' },
  { label: 'Risk Rules', href: '/dashboard/rules', section: 'Governance' },
  { label: 'Pinning Advisor', href: '/dashboard/pinning', section: 'Governance' },
  { label: 'Decision Ledger', href: '/dashboard/ledger', section: 'Governance' },
  { label: 'Incident Replays', href: '/dashboard/incidents', section: 'Intelligence' },
  { label: 'Alerts', href: '/dashboard/alerts', section: 'Intelligence' },
  { label: 'Reports', href: '/dashboard/reports', section: 'Intelligence' },
  { label: 'Notifications', href: '/dashboard/notifications', section: 'Settings' },
  { label: 'Webhooks', href: '/dashboard/webhooks', section: 'Settings' },
  { label: 'Settings', href: '/dashboard/settings', section: 'Settings' },
]

function fuzzyMatch(query: string, target: string) {
  if (!query) return true
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setActiveIndex(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const results = useMemo(
    () => ROUTES.filter((r) => fuzzyMatch(query, r.label) || fuzzyMatch(query, r.section)),
    [query],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter' && results[activeIndex]) {
              go(results[activeIndex].href)
            }
          }}
          placeholder="Jump to a page..."
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-zinc-500">No matching routes.</div>}
          {results.map((r, i) => (
            <button
              key={r.href}
              onClick={() => go(r.href)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                i === activeIndex ? 'bg-pink-500/10 text-pink-300' : 'text-zinc-300'
              }`}
            >
              <span>{r.label}</span>
              <span className="text-xs text-zinc-600">{r.section}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5">Cmd+K</kbd> to toggle, <kbd className="rounded bg-zinc-800 px-1.5 py-0.5">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
