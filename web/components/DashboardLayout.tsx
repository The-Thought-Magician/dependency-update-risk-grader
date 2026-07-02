'use client'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string; icon: string }

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: '⌂' },
  { label: 'Update Queue', href: '/dashboard/queue', icon: '☰' },
  { label: 'Updates', href: '/dashboard/updates', icon: '↑' },
  { label: 'Projects', href: '/dashboard/projects', icon: '▣' },
  { label: 'Packages', href: '/dashboard/packages', icon: '◫' },
  { label: 'Maintainers', href: '/dashboard/maintainers', icon: '◍' },
  { label: 'Policies', href: '/dashboard/policies', icon: '⚑' },
  { label: 'Risk Rules', href: '/dashboard/rules', icon: '⚠' },
  { label: 'Pinning Advisor', href: '/dashboard/pinning', icon: '📌' },
  { label: 'Decision Ledger', href: '/dashboard/ledger', icon: '≡' },
  { label: 'Incident Replays', href: '/dashboard/incidents', icon: '↻' },
  { label: 'Alerts', href: '/dashboard/alerts', icon: '◉' },
  { label: 'Reports', href: '/dashboard/reports', icon: '▤' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: '🔔' },
  { label: 'Webhooks', href: '/dashboard/webhooks', icon: '⇄' },
  { label: 'Settings', href: '/dashboard/settings', icon: '⚙' },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!mounted) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      setReady(true)
    })()
    return () => {
      mounted = false
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-500">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-pink-400" />
      </div>
    )
  }

  const rail = (
    <nav className="flex h-full flex-col items-center gap-3 overflow-y-auto py-5">
      <Link
        href="/dashboard"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-pink-400 text-sm font-black text-zinc-950"
      >
        D
      </Link>
      <div className="mt-2 flex flex-col items-center gap-1">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setDrawerOpen(false)}
              title={item.label}
              aria-label={item.label}
              className={`group relative flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors ${
                active ? 'bg-pink-400/10 text-pink-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
              }`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 shadow-lg group-hover:block">
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside className="hidden w-14 shrink-0 border-r border-zinc-800 bg-zinc-900/40 md:block">{rail}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-14 border-r border-zinc-800 bg-zinc-900">{rail}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-zinc-300">Workspace</span>
            <span className="hidden items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-500 sm:flex">
              Press <kbd className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-300">⌘K</kbd> to jump anywhere
            </span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
