'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface Incident {
  id: string
  slug: string
  name: string
  ecosystem: string
  package_name: string
  from_version: string | null
  to_version: string | null
  year: number | null
  summary: string | null
  catching_factor: string | null
  expected_grade: string | null
  details?: Record<string, unknown> | null
  created_at?: string
}

interface Workspace {
  id: string
  name: string
}

const WS_KEY = 'durg.workspace_id'

export default function IncidentsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [incidents, setIncidents] = useState<Incident[]>([])
  const [search, setSearch] = useState('')
  const [ecosystem, setEcosystem] = useState('all')

  const [detail, setDetail] = useState<Incident | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [replayId, setReplayId] = useState<string | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [replayResult, setReplayResult] = useState<{ updateId: string; grade?: string; expected?: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
        const list: Incident[] = await api.listIncidents()
        if (!mounted) return
        setIncidents(list || [])
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load incidents')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const ecosystems = useMemo(() => {
    const set = new Set<string>()
    incidents.forEach((i) => i.ecosystem && set.add(i.ecosystem))
    return Array.from(set).sort()
  }, [incidents])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incidents.filter((i) => {
      if (ecosystem !== 'all' && i.ecosystem !== ecosystem) return false
      if (!q) return true
      return (
        i.name.toLowerCase().includes(q) ||
        i.package_name.toLowerCase().includes(q) ||
        (i.summary || '').toLowerCase().includes(q) ||
        (i.catching_factor || '').toLowerCase().includes(q)
      )
    })
  }, [incidents, search, ecosystem])

  const stats = useMemo(() => {
    const byGrade: Record<string, number> = {}
    incidents.forEach((i) => {
      const g = (i.expected_grade || '?').toUpperCase()
      byGrade[g] = (byGrade[g] || 0) + 1
    })
    const critical = (byGrade['F'] || 0) + (byGrade['D'] || 0)
    return { total: incidents.length, ecosystems: ecosystems.length, critical }
  }, [incidents, ecosystems])

  async function openDetail(id: string) {
    setDetailLoading(true)
    setDetail(null)
    try {
      const d: Incident = await api.getIncident(id)
      setDetail(d)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to load incident')
    } finally {
      setDetailLoading(false)
    }
  }

  async function doReplay(id: string) {
    if (!workspaceId) {
      setActionError('Select a workspace before replaying an incident.')
      return
    }
    setReplaying(true)
    setReplayResult(null)
    setActionError(null)
    try {
      const res = await api.replayIncident(id, { workspace_id: workspaceId })
      const inc = incidents.find((i) => i.id === id)
      const grade = res?.score?.grade ?? res?.risk_score?.grade ?? res?.grade
      setReplayResult({ updateId: res?.id ?? res?.update?.id, grade, expected: inc?.expected_grade ?? undefined })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Replay failed')
    } finally {
      setReplaying(false)
    }
  }

  if (loading) return <PageSpinner label="Loading incident library..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load incidents"
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
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Incident Replay Library</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Replay real-world supply-chain attacks against your grading engine and confirm it would have caught them.
          </p>
        </div>
        {workspaces.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Replay into
            <select
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value)
                localStorage.setItem(WS_KEY, e.target.value)
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Catalogued incidents" value={stats.total} accent />
        <Stat label="Ecosystems covered" value={stats.ecosystems} />
        <Stat label="Expected D / F grade" value={stats.critical} hint="High-severity replays" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, package, factor..."
          className="min-w-[16rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500 focus:outline-none"
        />
        <select
          value={ecosystem}
          onChange={(e) => setEcosystem(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
        >
          <option value="all">All ecosystems</option>
          {ecosystems.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title="No incidents match"
          description="Try clearing the search or ecosystem filter."
          icon="🔍"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((inc) => (
            <Card key={inc.id} className="flex flex-col">
              <CardHeader className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-zinc-100">{inc.name}</h3>
                    {inc.year != null && <span className="text-xs text-zinc-600">{inc.year}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="lime">{inc.ecosystem}</Badge>
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                      {inc.package_name}
                    </code>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-600">Expected</span>
                  <GradeBadge grade={inc.expected_grade} />
                </div>
              </CardHeader>
              <CardBody className="flex flex-1 flex-col gap-3">
                {(inc.from_version || inc.to_version) && (
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5">{inc.from_version || '—'}</code>
                    <span className="text-zinc-600">→</span>
                    <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-amber-300">{inc.to_version || '—'}</code>
                  </div>
                )}
                {inc.summary && <p className="line-clamp-3 text-sm text-zinc-400">{inc.summary}</p>}
                {inc.catching_factor && (
                  <div className="text-xs text-zinc-500">
                    Caught by{' '}
                    <span className="font-medium text-pink-300">{inc.catching_factor.replace(/_/g, ' ')}</span>
                  </div>
                )}
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <Button variant="secondary" className="flex-1" onClick={() => openDetail(inc.id)}>
                    Details
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={replaying && replayId === inc.id}
                    onClick={() => {
                      setReplayId(inc.id)
                      void doReplay(inc.id)
                    }}
                  >
                    {replaying && replayId === inc.id ? <Spinner className="h-4 w-4" /> : 'Replay'}
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!detail || detailLoading} onClose={() => setDetail(null)} title={detail?.name || 'Incident'}>
        {detailLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="lime">{detail.ecosystem}</Badge>
              {detail.year != null && <Badge>{detail.year}</Badge>}
              <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
                Expected grade <GradeBadge grade={detail.expected_grade} />
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-zinc-600">Package</div>
              <div className="mt-1 flex items-center gap-2 text-zinc-200">
                <code className="rounded bg-zinc-800 px-1.5 py-0.5">{detail.package_name}</code>
                <span className="text-xs text-zinc-500">
                  {detail.from_version || '—'} → <span className="text-amber-300">{detail.to_version || '—'}</span>
                </span>
              </div>
            </div>
            {detail.summary && <p className="text-zinc-400">{detail.summary}</p>}
            {detail.catching_factor && (
              <div className="text-zinc-400">
                Catching factor:{' '}
                <span className="font-medium text-pink-300">{detail.catching_factor.replace(/_/g, ' ')}</span>
              </div>
            )}
            {detail.details && Object.keys(detail.details).length > 0 && (
              <pre className="max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                {JSON.stringify(detail.details, null, 2)}
              </pre>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                disabled={replaying}
                onClick={() => {
                  setReplayId(detail.id)
                  void doReplay(detail.id)
                }}
              >
                {replaying && replayId === detail.id ? <Spinner className="h-4 w-4" /> : 'Replay this incident'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Replay result modal */}
      <Modal
        open={!!replayResult}
        onClose={() => setReplayResult(null)}
        title="Replay complete"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReplayResult(null)}>
              Close
            </Button>
            {replayResult?.updateId && (
              <Button onClick={() => router.push(`/dashboard/updates/${replayResult.updateId}`)}>
                View graded update
              </Button>
            )}
          </>
        }
      >
        {replayResult && (
          <div className="space-y-4 text-sm">
            <p className="text-zinc-400">
              The incident was replayed as a fresh update in your workspace and scored by the live grading engine.
            </p>
            <div className="flex items-center justify-around rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-4">
              <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-zinc-600">Expected</div>
                <div className="mt-1">
                  <GradeBadge grade={replayResult.expected} />
                </div>
              </div>
              <span className="text-2xl text-zinc-700">→</span>
              <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-zinc-600">Graded</div>
                <div className="mt-1">
                  <GradeBadge grade={replayResult.grade} />
                </div>
              </div>
            </div>
            {replayResult.expected && replayResult.grade && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  replayResult.grade.toUpperCase() === replayResult.expected.toUpperCase()
                    ? 'border-pink-500/30 bg-pink-400/10 text-pink-300'
                    : 'border-amber-500/30 bg-amber-400/10 text-amber-300'
                }`}
              >
                {replayResult.grade.toUpperCase() === replayResult.expected.toUpperCase()
                  ? 'The grader matched the expected severity — this attack would have been flagged.'
                  : 'Graded severity differs from the catalogued expectation; review the factor breakdown.'}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
