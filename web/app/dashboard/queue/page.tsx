'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface Workspace {
  id: string
  name: string
}

interface QueueUpdate {
  id: string
  workspace_id: string
  project_id: string
  package_id: string
  from_version: string
  to_version: string
  ecosystem: string
  bump_type: string
  source: string
  status: string
  assigned_to?: string | null
  created_at?: string
  // joined extras from the queue endpoint
  grade?: string | null
  total_score?: number | null
  confidence?: number | null
  package_name?: string | null
  project_name?: string | null
}

type QueueColumns = Record<string, QueueUpdate[]>

const WS_KEY = 'durg.workspace_id'

const COLUMN_ORDER = ['pending', 'needs_review', 'approved', 'rejected', 'blocked'] as const

const COLUMN_LABEL: Record<string, string> = {
  pending: 'Pending',
  needs_review: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  blocked: 'Blocked',
}

const COLUMN_TONE: Record<string, 'amber' | 'blue' | 'green' | 'red' | 'neutral'> = {
  pending: 'amber',
  needs_review: 'blue',
  approved: 'green',
  rejected: 'red',
  blocked: 'red',
}

// Quick actions available on a queue row, mapped to the backend transition verbs.
const QUICK_ACTIONS: Array<{ action: string; label: string; variant: 'primary' | 'secondary' | 'danger' }> = [
  { action: 'approve', label: 'Approve', variant: 'primary' },
  { action: 'needs_review', label: 'Review', variant: 'secondary' },
  { action: 'block', label: 'Block', variant: 'danger' },
]

function fmtScore(n?: number | null): string {
  return n != null ? n.toFixed(1) : '–'
}

export default function QueuePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [columns, setColumns] = useState<QueueColumns>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [autoClearing, setAutoClearing] = useState(false)

  async function loadQueue(wsId: string) {
    const res = await api.getQueue(wsId)
    const cols = (res?.columns ?? {}) as QueueColumns
    setColumns(cols)
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!mounted) return
        setWorkspaces(ws || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const chosen = (stored && (ws || []).some((w) => w.id === stored) ? stored : ws?.[0]?.id) || ''
        setWorkspaceId(chosen)
        if (chosen) await loadQueue(chosen)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load review queue')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function switchWorkspace(id: string) {
    setWorkspaceId(id)
    localStorage.setItem(WS_KEY, id)
    setLoading(true)
    setError(null)
    try {
      await loadQueue(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load review queue')
    } finally {
      setLoading(false)
    }
  }

  const pending = columns.pending ?? []
  const needsReview = columns.needs_review ?? []

  const stats = useMemo(() => {
    const all = COLUMN_ORDER.flatMap((s) => columns[s] ?? [])
    const open = pending.length + needsReview.length
    const risky = [...pending, ...needsReview].filter((u) => {
      const g = (u.grade ?? '').toUpperCase()
      return g === 'D' || g === 'F'
    }).length
    return { total: all.length, open, pending: pending.length, risky }
  }, [columns, pending, needsReview])

  // The triage queue is the set of items still awaiting a human decision.
  const queue = useMemo(() => {
    return [...pending, ...needsReview].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0))
  }, [pending, needsReview])

  async function transition(u: QueueUpdate, action: string) {
    setBusyId(u.id)
    setActionError(null)
    try {
      await api.transitionUpdate(u.id, { action })
      if (workspaceId) await loadQueue(workspaceId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setBusyId(null)
    }
  }

  async function runAutoClear() {
    if (!workspaceId) return
    setAutoClearing(true)
    setActionError(null)
    try {
      await api.autoClear(workspaceId)
      await loadQueue(workspaceId)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Auto-clear failed')
    } finally {
      setAutoClearing(false)
    }
  }

  if (loading) return <PageSpinner label="Loading review queue..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load the queue"
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

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create a workspace first to start triaging dependency updates."
        icon="📭"
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Update review queue</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Pending and flagged dependency bumps awaiting a decision, ranked riskiest-first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {workspaces.length > 1 && (
            <select
              value={workspaceId}
              onChange={(e) => void switchWorkspace(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 focus:border-lime-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => void runAutoClear()} disabled={autoClearing || pending.length === 0}>
            {autoClearing ? <Spinner className="h-4 w-4" /> : 'Auto-clear safe'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Awaiting review" value={stats.open} accent={stats.open > 0} />
        <Stat label="Pending" value={stats.pending} />
        <Stat label="High risk (D/F)" value={stats.risky} hint="Need attention" />
        <Stat label="Total tracked" value={stats.total} />
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyState
          title="Queue is clear"
          description="No updates are awaiting review. New bump PRs land here as they are imported and graded."
          icon="✅"
        />
      ) : (
        <div className="space-y-3">
          {queue.map((u) => {
            const pkgName = u.package_name ?? u.package_id
            const projName = u.project_name ?? u.project_id
            return (
              <Card key={u.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <GradeBadge grade={u.grade} className="text-base px-2.5 py-1" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/updates/${u.id}`}
                        className="truncate font-medium text-neutral-100 hover:text-lime-300"
                      >
                        {pkgName}
                      </Link>
                      <Badge tone="neutral">{u.ecosystem}</Badge>
                      <Badge tone={COLUMN_TONE[u.status] ?? 'neutral'}>{COLUMN_LABEL[u.status] ?? u.status}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-neutral-400">{u.from_version}</code>
                      <span className="text-lime-400">→</span>
                      <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-lime-300">{u.to_version}</code>
                      <span className="text-neutral-600">·</span>
                      <span>{u.bump_type} bump</span>
                      <span className="text-neutral-600">·</span>
                      <span>in {projName}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-neutral-600">Score</div>
                    <div className="text-sm font-semibold tabular-nums text-neutral-200">{fmtScore(u.total_score)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {QUICK_ACTIONS.map((a) => (
                      <Button
                        key={a.action}
                        variant={a.variant}
                        disabled={busyId === u.id}
                        onClick={() => void transition(u, a.action)}
                      >
                        {busyId === u.id ? <Spinner className="h-4 w-4" /> : a.label}
                      </Button>
                    ))}
                    <Link href={`/dashboard/updates/${u.id}`}>
                      <Button variant="ghost">Details</Button>
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Resolved columns summary */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-100">Resolved this workspace</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-3 gap-4 text-center">
            {(['approved', 'rejected', 'blocked'] as const).map((s) => (
              <div key={s} className="rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3">
                <div className="text-2xl font-semibold text-neutral-100">{(columns[s] ?? []).length}</div>
                <div className="mt-0.5 text-xs uppercase tracking-wide text-neutral-500">{COLUMN_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
