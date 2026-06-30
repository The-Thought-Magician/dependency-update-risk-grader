'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  slug?: string
  auto_clear_max_grade?: string | null
}

interface TopRisk {
  update_id?: string
  id?: string
  package_name?: string
  package?: string
  from_version?: string
  to_version?: string
  grade?: string | null
  total_score?: number | null
  score?: number | null
}

interface LedgerRow {
  id: string
  decision?: string
  grade_at_decision?: string | null
  score_at_decision?: number | null
  actor_id?: string | null
  package_name?: string | null
  package?: string | null
  justification?: string | null
  created_at?: string
}

interface TrendPoint {
  date?: string
  label?: string
  count?: number
  graded?: number
  blocked?: number
  approved?: number
}

interface DashboardSummary {
  grade_counts?: Record<string, number>
  gradeCounts?: Record<string, number>
  pending?: number
  pending_count?: number
  auto_cleared?: number
  autoCleared?: number
  violations?: number
  policy_violations?: number
  total_updates?: number
  trend?: TrendPoint[]
  top_risk?: TopRisk[]
  topRisk?: TopRisk[]
  recent_ledger?: LedgerRow[]
  recentLedger?: LedgerRow[]
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function decisionTone(decision?: string): 'green' | 'red' | 'amber' | 'blue' | 'neutral' {
  switch ((decision ?? '').toLowerCase()) {
    case 'approve':
    case 'approved':
    case 'auto_clear':
    case 'auto-cleared':
      return 'green'
    case 'reject':
    case 'rejected':
    case 'block':
    case 'blocked':
      return 'red'
    case 'needs_review':
    case 'needs-review':
      return 'amber'
    default:
      return 'neutral'
  }
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const WS_KEY = 'durg.workspace_id'

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [wsLoading, setWsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load workspaces once and pick an initial one.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!mounted) return
        const list = Array.isArray(ws) ? ws : []
        setWorkspaces(list)
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const initial = (stored && list.some((w) => w.id === stored) ? stored : list[0]?.id) || ''
        setWorkspaceId(initial)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setWsLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const loadDashboard = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const data: DashboardSummary = await api.getDashboard(wsId)
      setSummary(data ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!workspaceId) {
      if (!wsLoading) setLoading(false)
      return
    }
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, workspaceId)
    void loadDashboard(workspaceId)
  }, [workspaceId, wsLoading, loadDashboard])

  const gradeCounts = useMemo(() => {
    const raw = summary?.grade_counts ?? summary?.gradeCounts ?? {}
    const out: Record<string, number> = {}
    for (const g of GRADE_ORDER) out[g] = num(raw[g] ?? raw[g.toLowerCase()])
    return out
  }, [summary])

  const totalGraded = useMemo(() => GRADE_ORDER.reduce((a, g) => a + gradeCounts[g], 0), [gradeCounts])
  const trend = summary?.trend ?? []
  const topRisk = summary?.top_risk ?? summary?.topRisk ?? []
  const recentLedger = summary?.recent_ledger ?? summary?.recentLedger ?? []
  const pending = num(summary?.pending ?? summary?.pending_count)
  const autoCleared = num(summary?.auto_cleared ?? summary?.autoCleared)
  const violations = num(summary?.violations ?? summary?.policy_violations)

  const maxTrend = useMemo(
    () => Math.max(1, ...trend.map((t) => num(t.count ?? t.graded))),
    [trend],
  )

  if (wsLoading) return <PageSpinner label="Loading workspaces..." />

  if (!wsLoading && workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <Header
          workspaces={workspaces}
          workspaceId={workspaceId}
          onChange={setWorkspaceId}
          onRefresh={() => workspaceId && loadDashboard(workspaceId)}
        />
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace from Settings to start grading dependency updates and tracking your risk posture."
          action={
            <Link href="/dashboard/settings">
              <Button variant="primary">Go to Settings</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        workspaces={workspaces}
        workspaceId={workspaceId}
        onChange={setWorkspaceId}
        onRefresh={() => workspaceId && loadDashboard(workspaceId)}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading risk posture..." />
      ) : !summary ? (
        <EmptyState title="No data" description="Could not load posture for this workspace." />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Graded updates" value={totalGraded} hint="Total scored bumps" accent />
            <Stat label="Pending triage" value={pending} hint="Awaiting a decision" />
            <Stat label="Auto-cleared" value={autoCleared} hint="Below grade threshold" />
            <Stat label="Policy violations" value={violations} hint="Failed gate checks" />
          </div>

          {/* Grade distribution */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-100">Grade distribution</h2>
              <span className="text-xs text-neutral-500">{totalGraded} graded</span>
            </CardHeader>
            <CardBody>
              {totalGraded === 0 ? (
                <p className="text-sm text-neutral-500">No graded updates yet for this workspace.</p>
              ) : (
                <div className="space-y-3">
                  {GRADE_ORDER.map((g) => {
                    const c = gradeCounts[g]
                    const pct = totalGraded > 0 ? Math.round((c / totalGraded) * 100) : 0
                    const bar =
                      g === 'A'
                        ? 'bg-emerald-400'
                        : g === 'B'
                          ? 'bg-lime-400'
                          : g === 'C'
                            ? 'bg-amber-400'
                            : g === 'D'
                              ? 'bg-orange-400'
                              : 'bg-red-500'
                    return (
                      <div key={g} className="flex items-center gap-3">
                        <GradeBadge grade={g} />
                        <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-800">
                          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-xs tabular-nums text-neutral-400">
                          {c} · {pct}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Trend (SVG-free bar chart) */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-neutral-100">Grading trend</h2>
              </CardHeader>
              <CardBody>
                {trend.length === 0 ? (
                  <p className="text-sm text-neutral-500">No trend data yet.</p>
                ) : (
                  <div className="flex h-40 items-end gap-1">
                    {trend.map((t, i) => {
                      const v = num(t.count ?? t.graded)
                      const h = Math.round((v / maxTrend) * 100)
                      return (
                        <div key={i} className="group flex flex-1 flex-col items-center gap-1">
                          <div className="flex w-full flex-1 items-end">
                            <div
                              className="w-full rounded-t bg-lime-400/70 transition-colors group-hover:bg-lime-300"
                              style={{ height: `${Math.max(h, 2)}%` }}
                              title={`${t.label ?? t.date ?? ''}: ${v}`}
                            />
                          </div>
                          <span className="truncate text-[9px] text-neutral-600">
                            {(t.label ?? t.date ?? '').toString().slice(5, 10)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Top risk */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-neutral-100">Top-risk updates</h2>
                <Link href="/dashboard/queue" className="text-xs text-lime-300 hover:text-lime-200">
                  View queue →
                </Link>
              </CardHeader>
              <CardBody className="p-0">
                {topRisk.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-neutral-500">No high-risk updates.</p>
                ) : (
                  <ul className="divide-y divide-neutral-800">
                    {topRisk.slice(0, 6).map((u, i) => {
                      const id = u.update_id ?? u.id
                      const name = u.package_name ?? u.package ?? 'unknown'
                      const score = num(u.total_score ?? u.score)
                      const row = (
                        <div className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-neutral-900/60">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-neutral-100">{name}</div>
                            <div className="truncate text-xs text-neutral-500">
                              {u.from_version ?? '?'} → {u.to_version ?? '?'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs tabular-nums text-neutral-400">{score.toFixed(0)}</span>
                            <GradeBadge grade={u.grade} />
                          </div>
                        </div>
                      )
                      return (
                        <li key={id ?? i}>
                          {id ? <Link href={`/dashboard/updates/${id}`}>{row}</Link> : row}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Recent ledger */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-100">Recent decisions</h2>
              <Link href="/dashboard/ledger" className="text-xs text-lime-300 hover:text-lime-200">
                Full ledger →
              </Link>
            </CardHeader>
            <CardBody className="p-0">
              {recentLedger.length === 0 ? (
                <p className="px-5 py-4 text-sm text-neutral-500">No decisions recorded yet.</p>
              ) : (
                <Table className="border-0">
                  <THead>
                    <TR>
                      <TH>Package</TH>
                      <TH>Decision</TH>
                      <TH>Grade</TH>
                      <TH>Actor</TH>
                      <TH>When</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {recentLedger.slice(0, 8).map((l) => (
                      <TR key={l.id}>
                        <TD className="font-medium text-neutral-100">{l.package_name ?? l.package ?? '—'}</TD>
                        <TD>
                          <Badge tone={decisionTone(l.decision)}>{l.decision ?? '—'}</Badge>
                        </TD>
                        <TD>
                          <GradeBadge grade={l.grade_at_decision} />
                        </TD>
                        <TD className="text-neutral-400">{l.actor_id ?? 'system'}</TD>
                        <TD className="text-neutral-500">{fmtDate(l.created_at)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function Header({
  workspaces,
  workspaceId,
  onChange,
  onRefresh,
}: {
  workspaces: Workspace[]
  workspaceId: string
  onChange: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-50">Risk posture</h1>
        <p className="text-sm text-neutral-500">Supply-chain grade overview across your tracked updates.</p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={workspaceId}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-lime-500/60"
        >
          {workspaces.length === 0 && <option value="">No workspaces</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={onRefresh} disabled={!workspaceId}>
          Refresh
        </Button>
      </div>
    </div>
  )
}
