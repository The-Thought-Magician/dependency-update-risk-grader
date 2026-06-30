'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Update {
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
  updated_at?: string
  // joined extras
  package_name?: string | null
  project_name?: string | null
  grade?: string | null
  total_score?: number | null
}

const WS_KEY = 'durg.workspace_id'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'blocked', label: 'Blocked' },
]

const STATUS_TONE: Record<string, 'amber' | 'blue' | 'green' | 'red' | 'neutral'> = {
  pending: 'amber',
  needs_review: 'blue',
  approved: 'green',
  rejected: 'red',
  blocked: 'red',
}

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 }

function humanizeStatus(s: string): string {
  return s.replace(/_/g, ' ')
}

function fmtScore(n?: number | null): string {
  return n != null ? n.toFixed(1) : '–'
}

export default function UpdatesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [updates, setUpdates] = useState<Update[]>([])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [ecosystem, setEcosystem] = useState('all')

  const loadUpdates = useCallback(async (wsId: string, statusFilter: string) => {
    const rows = await api.listUpdates({
      workspace_id: wsId,
      status: statusFilter || undefined,
    })
    setUpdates(Array.isArray(rows) ? rows : [])
  }, [])

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
        if (chosen) await loadUpdates(chosen, '')
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load updates')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadUpdates])

  // Reload from the server whenever the workspace or status filter changes.
  useEffect(() => {
    if (!workspaceId) return
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        await loadUpdates(workspaceId, status)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load updates')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, status])

  function switchWorkspace(id: string) {
    setWorkspaceId(id)
    localStorage.setItem(WS_KEY, id)
  }

  const ecosystems = useMemo(() => {
    const set = new Set<string>()
    updates.forEach((u) => u.ecosystem && set.add(u.ecosystem))
    return Array.from(set).sort()
  }, [updates])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = updates.filter((u) => {
      if (ecosystem !== 'all' && u.ecosystem !== ecosystem) return false
      if (!q) return true
      return (
        (u.package_name ?? '').toLowerCase().includes(q) ||
        (u.project_name ?? '').toLowerCase().includes(q) ||
        u.to_version.toLowerCase().includes(q)
      )
    })
    // Riskiest grade first, then highest score.
    return [...rows].sort((a, b) => {
      const ga = GRADE_ORDER[(a.grade ?? '').toUpperCase()] ?? -1
      const gb = GRADE_ORDER[(b.grade ?? '').toUpperCase()] ?? -1
      if (gb !== ga) return gb - ga
      return (b.total_score ?? 0) - (a.total_score ?? 0)
    })
  }, [updates, search, ecosystem])

  const stats = useMemo(() => {
    const graded = updates.filter((u) => u.grade)
    const risky = updates.filter((u) => ['D', 'F'].includes((u.grade ?? '').toUpperCase())).length
    const pending = updates.filter((u) => u.status === 'pending' || u.status === 'needs_review').length
    return { total: updates.length, graded: graded.length, risky, pending }
  }, [updates])

  if (loading && updates.length === 0) return <PageSpinner label="Loading updates..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load updates"
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
        description="Create a workspace first to start tracking dependency updates."
        icon="📭"
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Updates</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every graded dependency bump across this workspace, with risk grade and decision status.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => switchWorkspace(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 focus:border-lime-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total updates" value={stats.total} accent />
        <Stat label="Graded" value={stats.graded} />
        <Stat label="Awaiting review" value={stats.pending} />
        <Stat label="High risk (D/F)" value={stats.risky} hint="Riskiest bumps" />
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by package, project, version..."
              className="min-w-[200px] flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500/50 focus:outline-none"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value || 'all'} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              <option value="all">All ecosystems</option>
              {ecosystems.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={updates.length === 0 ? 'No updates yet' : 'No matches'}
          description={
            updates.length === 0
              ? 'Import a Dependabot/Renovate payload or add an update to start grading bump PRs.'
              : 'Try a different search term, status, or ecosystem filter.'
          }
          icon="🔍"
        />
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-200">
              {filtered.length} update{filtered.length === 1 ? '' : 's'}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Grade</TH>
                  <TH>Package</TH>
                  <TH>Version</TH>
                  <TH>Project</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Score</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <GradeBadge grade={u.grade} />
                    </TD>
                    <TD>
                      <Link
                        href={`/dashboard/updates/${u.id}`}
                        className="font-medium text-neutral-100 hover:text-lime-300"
                      >
                        {u.package_name ?? u.package_id}
                      </Link>
                      <span className="ml-2 text-xs text-neutral-600">{u.ecosystem}</span>
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5 text-xs">
                        <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-neutral-400">{u.from_version}</code>
                        <span className="text-lime-400">→</span>
                        <code className="rounded bg-neutral-950 px-1.5 py-0.5 text-lime-300">{u.to_version}</code>
                      </div>
                    </TD>
                    <TD className="text-sm text-neutral-400">{u.project_name ?? u.project_id}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[u.status] ?? 'neutral'}>{humanizeStatus(u.status)}</Badge>
                    </TD>
                    <TD className="text-right font-mono text-xs tabular-nums text-neutral-300">
                      {fmtScore(u.total_score)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
