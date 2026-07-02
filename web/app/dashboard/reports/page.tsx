'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Report {
  id: string
  workspace_id: string
  type: string
  title: string
  params?: Record<string, unknown> | null
  data?: Record<string, unknown> | null
  created_by?: string | null
  created_at?: string | null
}

const WS_KEY = 'durg.workspace_id'

const REPORT_TYPES: Array<{ value: 'project' | 'throughput' | 'maintainer-change'; label: string; blurb: string }> = [
  { value: 'project', label: 'Project risk', blurb: 'Grade distribution and worst grade per project.' },
  { value: 'throughput', label: 'Throughput', blurb: 'Updates created vs resolved, auto-clear rate, time-to-decision.' },
  { value: 'maintainer-change', label: 'Maintainer change', blurb: 'Updates that introduced a new (possibly low-trust) maintainer.' },
]

const TYPE_TONE: Record<string, 'lime' | 'blue' | 'amber' | 'neutral'> = {
  project: 'lime',
  throughput: 'blue',
  'maintainer-change': 'amber',
}

function fmtDate(s?: string | null): string {
  if (!s) return '–'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function typeLabel(t: string): string {
  return REPORT_TYPES.find((r) => r.value === t)?.label ?? t
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [reports, setReports] = useState<Report[]>([])

  const [genType, setGenType] = useState<'project' | 'throughput' | 'maintainer-change'>('project')
  const [generating, setGenerating] = useState(false)

  const [viewing, setViewing] = useState<Report | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadReports(wsId: string) {
    const rows = await api.listReports(wsId)
    setReports(Array.isArray(rows) ? rows : [])
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
        if (chosen) await loadReports(chosen)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load reports')
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
      await loadReports(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }

  async function generate() {
    if (!workspaceId) return
    setGenerating(true)
    setActionError(null)
    try {
      const created: Report = await api.generateReport({ workspace_id: workspaceId, type: genType })
      setReports((prev) => [created, ...prev])
      setViewing(created)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  async function openReport(r: Report) {
    // Listing returns full rows, but re-fetch to be safe about the data payload.
    setViewLoading(true)
    setViewing(r)
    try {
      const full: Report = await api.getReport(r.id)
      setViewing(full)
    } catch {
      // fall back to the list row
    } finally {
      setViewLoading(false)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    setActionError(null)
    try {
      await api.deleteReport(id)
      setReports((prev) => prev.filter((r) => r.id !== id))
      if (viewing?.id === id) setViewing(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete report')
    } finally {
      setDeletingId(null)
    }
  }

  const stats = useMemo(() => {
    const byType: Record<string, number> = {}
    reports.forEach((r) => (byType[r.type] = (byType[r.type] ?? 0) + 1))
    return {
      total: reports.length,
      project: byType.project ?? 0,
      throughput: byType.throughput ?? 0,
      maintainer: byType['maintainer-change'] ?? 0,
    }
  }, [reports])

  if (loading) return <PageSpinner label="Loading reports..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load reports"
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
        description="Create a workspace first to generate risk reports."
        icon="📭"
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Reports</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Generate point-in-time aggregations over your workspace risk data.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => void switchWorkspace(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
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
        <Stat label="Saved reports" value={stats.total} accent />
        <Stat label="Project" value={stats.project} />
        <Stat label="Throughput" value={stats.throughput} />
        <Stat label="Maintainer change" value={stats.maintainer} />
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {/* Generator */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Generate a report</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {REPORT_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setGenType(t.value)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  genType === t.value
                    ? 'border-pink-500/40 bg-pink-400/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge tone={TYPE_TONE[t.value]}>{t.label}</Badge>
                </div>
                <p className="mt-2 text-xs text-zinc-500">{t.blurb}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void generate()} disabled={generating}>
              {generating ? <Spinner className="h-4 w-4" /> : `Generate ${typeLabel(genType)} report`}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Saved reports */}
      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Generate your first report above to capture a snapshot of workspace risk."
          icon="📊"
        />
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Saved reports</h2>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Type</TH>
                  <TH>Generated</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {reports.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-zinc-100">{r.title}</TD>
                    <TD>
                      <Badge tone={TYPE_TONE[r.type] ?? 'neutral'}>{typeLabel(r.type)}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-500">{fmtDate(r.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => void openReport(r)}>
                          View
                        </Button>
                        <a
                          href={`/api/proxy/reports/${r.id}/export?format=csv`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button variant="ghost">CSV</Button>
                        </a>
                        <Button
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                          disabled={deletingId === r.id}
                          onClick={() => void remove(r.id)}
                        >
                          {deletingId === r.id ? <Spinner className="h-4 w-4" /> : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Report viewer */}
      <Modal
        open={viewing != null}
        onClose={() => setViewing(null)}
        title={viewing?.title ?? 'Report'}
        className="max-w-3xl"
        footer={
          <>
            {viewing && (
              <a href={`/api/proxy/reports/${viewing.id}/export?format=csv`} target="_blank" rel="noreferrer">
                <Button variant="secondary">Download CSV</Button>
              </a>
            )}
            <Button variant="ghost" onClick={() => setViewing(null)}>
              Close
            </Button>
          </>
        }
      >
        {viewLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : viewing ? (
          <ReportContent report={viewing} />
        ) : null}
      </Modal>
    </div>
  )
}

// ---- Report body renderers --------------------------------------------------

function ReportContent({ report }: { report: Report }) {
  const data = (report.data ?? {}) as Record<string, unknown>
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <Badge tone={TYPE_TONE[report.type] ?? 'neutral'}>{typeLabel(report.type)}</Badge>
        <span className="text-xs text-zinc-500">{fmtDate(report.created_at)}</span>
      </div>
      {report.type === 'project' && <ProjectReport data={data} />}
      {report.type === 'throughput' && <ThroughputReport data={data} />}
      {report.type === 'maintainer-change' && <MaintainerReport data={data} />}
    </div>
  )
}

interface ProjectRow {
  project_id: string
  project_name: string | null
  ecosystem: string | null
  total_updates: number
  graded: number
  avg_score: number | null
  worst_grade: string | null
  pending: number
  blocked: number
}

function ProjectReport({ data }: { data: Record<string, unknown> }) {
  const projects = (data.projects as ProjectRow[] | undefined) ?? []
  if (projects.length === 0) return <p className="text-zinc-500">No project data in this report.</p>
  return (
    <Table>
      <THead>
        <TR>
          <TH>Project</TH>
          <TH>Worst</TH>
          <TH className="text-right">Updates</TH>
          <TH className="text-right">Avg score</TH>
          <TH className="text-right">Pending</TH>
          <TH className="text-right">Blocked</TH>
        </TR>
      </THead>
      <TBody>
        {projects.map((p) => (
          <TR key={p.project_id}>
            <TD className="text-zinc-200">
              {p.project_name ?? p.project_id}
              {p.ecosystem && <span className="ml-2 text-xs text-zinc-600">{p.ecosystem}</span>}
            </TD>
            <TD>
              <GradeBadge grade={p.worst_grade} />
            </TD>
            <TD className="text-right tabular-nums">{p.total_updates}</TD>
            <TD className="text-right tabular-nums">{p.avg_score != null ? p.avg_score.toFixed(1) : '–'}</TD>
            <TD className="text-right tabular-nums">{p.pending}</TD>
            <TD className="text-right tabular-nums">{p.blocked}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

function ThroughputReport({ data }: { data: Record<string, unknown> }) {
  const created = Number(data.created ?? 0)
  const resolved = Number(data.resolved ?? 0)
  const autoCleared = Number(data.auto_cleared ?? 0)
  const autoClearRate = Number(data.auto_clear_rate ?? 0)
  const avgHours = data.avg_resolution_hours as number | null | undefined
  const windowDays = Number(data.window_days ?? 30)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={`Created (${windowDays}d)`} value={created} accent />
        <Stat label="Resolved" value={resolved} />
        <Stat label="Auto-cleared" value={autoCleared} />
        <Stat label="Auto-clear rate" value={`${Math.round(autoClearRate * 100)}%`} />
        <Stat label="Avg time-to-decision" value={avgHours != null ? `${avgHours}h` : '–'} />
      </div>
    </div>
  )
}

interface MaintainerChange {
  update_id: string
  package_name: string | null
  ecosystem: string | null
  from_version: string
  to_version: string
  status: string
  grade: string | null
  low_trust_introduced?: boolean
  added_maintainers?: Array<{ username: string; trust_score: number }>
}

function MaintainerReport({ data }: { data: Record<string, unknown> }) {
  const changes = (data.changes as MaintainerChange[] | undefined) ?? []
  const flagged = Number(data.flagged ?? changes.length)
  if (changes.length === 0)
    return <p className="text-zinc-500">No maintainer changes detected across this workspace.</p>
  return (
    <div className="space-y-3">
      <div className="text-xs text-zinc-500">{flagged} update(s) introduced or removed a maintainer.</div>
      <Table>
        <THead>
          <TR>
            <TH>Package</TH>
            <TH>Grade</TH>
            <TH>New maintainers</TH>
          </TR>
        </THead>
        <TBody>
          {changes.map((ch) => (
            <TR key={ch.update_id}>
              <TD className="text-zinc-200">
                {ch.package_name ?? '–'}
                <span className="ml-2 text-xs text-zinc-600">
                  {ch.from_version} → {ch.to_version}
                </span>
              </TD>
              <TD>
                <GradeBadge grade={ch.grade} />
              </TD>
              <TD>
                <div className="flex flex-wrap items-center gap-1">
                  {(ch.added_maintainers ?? []).map((m) => (
                    <code
                      key={m.username}
                      className="rounded bg-zinc-950 px-1.5 py-0.5 text-xs text-zinc-300"
                      title={`trust ${m.trust_score}`}
                    >
                      {m.username}
                    </code>
                  ))}
                  {ch.low_trust_introduced && <Badge tone="red">low trust</Badge>}
                  {(ch.added_maintainers ?? []).length === 0 && (
                    <span className="text-xs text-zinc-600">none added</span>
                  )}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}
