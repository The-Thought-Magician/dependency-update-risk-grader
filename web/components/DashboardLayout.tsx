'use client'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  { title: 'Overview', items: [{ label: 'Dashboard', href: '/dashboard' }] },
  {
    title: 'Triage',
    items: [
      { label: 'Update Queue', href: '/dashboard/queue' },
      { label: 'Updates', href: '/dashboard/updates' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Projects', href: '/dashboard/projects' },
      { label: 'Packages', href: '/dashboard/packages' },
      { label: 'Maintainers', href: '/dashboard/maintainers' },
    ],
  },
  {
    title: 'Governance',
    items: [
      { label: 'Policies', href: '/dashboard/policies' },
      { label: 'Risk Rules', href: '/dashboard/rules' },
      { label: 'Pinning Advisor', href: '/dashboard/pinning' },
      { label: 'Decision Ledger', href: '/dashboard/ledger' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { label: 'Incident Replays', href: '/dashboard/incidents' },
      { label: 'Alerts', href: '/dashboard/alerts' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Webhooks', href: '/dashboard/webhooks' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
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
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-500">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-lime-400" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime-400 text-sm font-black text-neutral-950">
          D
        </span>
        <span className="text-sm font-bold tracking-tight text-neutral-100">DependencyUpdateRiskGrader</span>
      </Link>
      <div className="flex flex-col gap-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              {section.title}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-lime-400/10 font-medium text-lime-300'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-neutral-950">
      <aside className="hidden w-64 shrink-0 border-r border-neutral-800 bg-neutral-900/40 md:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-neutral-800 bg-neutral-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-neutral-300">Workspace</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 transition-colors hover:bg-neutral-700"
          >
            Sign out
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
