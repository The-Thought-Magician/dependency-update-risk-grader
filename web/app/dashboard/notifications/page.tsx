'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  user_id: string
  workspace_id: string | null
  type: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

type Filter = 'all' | 'unread' | 'read'

function typeTone(type: string): 'red' | 'amber' | 'lime' | 'blue' | 'neutral' {
  const t = type.toLowerCase()
  if (t.includes('alert') || t.includes('block') || t.includes('risk')) return 'red'
  if (t.includes('review') || t.includes('warn')) return 'amber'
  if (t.includes('clear') || t.includes('approve') || t.includes('resolved')) return 'lime'
  if (t.includes('report') || t.includes('digest')) return 'blue'
  return 'neutral'
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [items, setItems] = useState<Notification[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const list: Notification[] = await api.listNotifications()
        if (!mounted) return
        setItems(list || [])
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load notifications')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const types = useMemo(() => {
    const s = new Set<string>()
    items.forEach((n) => n.type && s.add(n.type))
    return Array.from(s).sort()
  }, [items])

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items])

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (filter === 'unread' && n.is_read) return false
      if (filter === 'read' && !n.is_read) return false
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      return true
    })
  }, [items, filter, typeFilter])

  async function markRead(id: string) {
    setBusyId(id)
    setActionError(null)
    try {
      await api.readNotification(id)
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark as read')
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    setMarkingAll(true)
    setActionError(null)
    try {
      await api.readAllNotifications()
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to mark all as read')
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) return <PageSpinner label="Loading notifications..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load notifications"
          description={error}
          icon="⚠"
          action={
            <Button variant="secondary" onClick={() => location.reload()}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Personal updates from your workspaces: graded bumps, decisions, alerts and reports.
          </p>
        </div>
        <Button variant="secondary" disabled={markingAll || unreadCount === 0} onClick={() => void markAll()}>
          {markingAll ? <Spinner className="h-4 w-4" /> : 'Mark all as read'}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={items.length} />
        <Stat label="Unread" value={unreadCount} accent={unreadCount > 0} />
        <Stat label="Read" value={items.length - unreadCount} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {(['all', 'unread', 'read'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                filter === f ? 'bg-pink-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {f}
              {f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
            </button>
          ))}
        </div>
        {types.length > 0 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
          >
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'No notifications' : 'Nothing matches this filter'}
          description={
            items.length === 0
              ? "You're all caught up. New activity in your workspaces will show up here."
              : 'Try a different filter to see more.'
          }
          icon="🔔"
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const inner = (
              <div className="flex items-start gap-3">
                {!n.is_read ? (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pink-400" aria-label="Unread" />
                ) : (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-700" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-medium ${n.is_read ? 'text-zinc-300' : 'text-zinc-100'}`}>
                      {n.title}
                    </span>
                    <Badge tone={typeTone(n.type)}>{n.type.replace(/_/g, ' ')}</Badge>
                    <span className="ml-auto text-xs text-zinc-600">{relativeTime(n.created_at)}</span>
                  </div>
                  {n.body && <p className="mt-1 text-sm text-zinc-400">{n.body}</p>}
                </div>
                {!n.is_read && (
                  <Button
                    variant="ghost"
                    disabled={busyId === n.id}
                    onClick={(e) => {
                      e.preventDefault()
                      void markRead(n.id)
                    }}
                  >
                    {busyId === n.id ? <Spinner className="h-4 w-4" /> : 'Mark read'}
                  </Button>
                )}
              </div>
            )
            return (
              <Card
                key={n.id}
                className={`px-4 py-3 transition-colors ${
                  n.is_read ? '' : 'border-pink-500/20 bg-pink-400/[0.03]'
                }`}
              >
                {n.link ? (
                  <Link
                    href={n.link}
                    onClick={() => {
                      if (!n.is_read) void markRead(n.id)
                    }}
                    className="block"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
