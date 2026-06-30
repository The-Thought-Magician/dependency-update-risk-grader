'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Project {
  id: string
  name: string
  ecosystem?: string
  dependency_count?: number
}

interface PinningAdvice {
  id: string
  workspace_id?: string
  project_id?: string
  package_id?: string
  package_name?: string
  package?: string
  project_name?: string
  recommendation: string
  suggested_version?: string | null
  rationale?: string | null
  patch_snippet?: string | null
  created_at?: string
}

// Maps a recommendation string to a tone + label. Defensive against unknown
// recommendation values the backend may emit.
function recommendationMeta(rec?: string): { tone: 'green' | 'lime' | 'amber' | 'red' | 'neutral'; label: string } {
  const r = (rec ?? '').toLowerCase()
  if (r.includes('pin')) return { tone: 'lime', label: 'Pin exact version' }
  if (r.includes('range') || r.includes('caret') || r.includes('widen')) return { tone: 'amber', label: 'Tighten range' }
  if (r.includes('hold') || r.includes('block') || r.includes('avoid')) return { tone: 'red', label: 'Hold / avoid' }
  if (r.includes('allow') || r.includes('ok') || r.includes('safe')) return { tone: 'green', label: 'Allow' }
  return { tone: 'neutral', label: rec ?? 'Review' }
}

export default function PinningPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [advice, setAdvice] = useState<PinningAdvice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [projectFilter, setProjectFilter] = useState<string>('') // '' = all
  const [recFilter, setRecFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [genProject, setGenProject] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const [detail, setDetail] = useState<PinningAdvice | null>(null)

  const loadAdvice = useCallback(async (wsId: string, projectId: string) => {
    const params: { workspace_id?: string; project_id?: string } = { workspace_id: wsId }
    if (projectId) params.project_id = projectId
    const rows = await api.listPinningAdvice(params)
    setAdvice(Array.isArray(rows) ? rows : [])
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const workspaces = await api.listWorkspaces()
      const ws = Array.isArray(workspaces) ? workspaces[0] : null
      if (!ws) {
        setWorkspaceId(null)
        setLoading(false)
        return
      }
      setWorkspaceId(ws.id)
      const projList: Project[] = await api.listProjects(ws.id)
      setProjects(Array.isArray(projList) ? projList : [])
      await loadAdvice(ws.id, '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pinning advice')
    } finally {
      setLoading(false)
    }
  }, [loadAdvice])

  useEffect(() => {
    load()
  }, [load])

  // Re-fetch advice when the project filter changes (server-side filter).
  useEffect(() => {
    if (!workspaceId || loading) return
    let active = true
    ;(async () => {
      try {
        setError(null)
        if (active) await loadAdvice(workspaceId, projectFilter)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to filter advice')
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter])

  const projectName = useCallback(
    (id?: string) => projects.find((p) => p.id === id)?.name ?? id ?? '—',
    [projects],
  )

  const filtered = useMemo(() => {
    return advice.filter((a) => {
      if (recFilter !== 'all') {
        const meta = recommendationMeta(a.recommendation)
        if (meta.label !== recFilter) return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${a.package_name ?? a.package ?? ''} ${a.suggested_version ?? ''} ${a.rationale ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [advice, recFilter, search])

  const recCategories = useMemo(() => {
    const set = new Set<string>()
    for (const a of advice) set.add(recommendationMeta(a.recommendation).label)
    return Array.from(set)
  }, [advice])

  const stats = useMemo(() => {
    const counts = { pin: 0, range: 0, hold: 0, other: 0 }
    for (const a of advice) {
      const t = recommendationMeta(a.recommendation).tone
      if (t === 'lime') counts.pin++
      else if (t === 'amber') counts.range++
      else if (t === 'red') counts.hold++
      else counts.other++
    }
    return counts
  }, [advice])

  async function handleGenerate() {
    if (!workspaceId || !genProject) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.generatePinningAdvice({ workspace_id: workspaceId, project_id: genProject })
      const created: PinningAdvice[] = Array.isArray(res?.advice) ? res.advice : []
      setNotice(`Generated ${created.length} pinning recommendation${created.length === 1 ? '' : 's'}.`)
      // Refresh under the current filter so the new advice is visible.
      await loadAdvice(workspaceId, projectFilter)
      setGenProject('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate advice')
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <PageSpinner label="Loading pinning advisor..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          title="No workspace found"
          description="Create a workspace and a project before generating pinning advice."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Pinning Advisor</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Per-package recommendations to pin, tighten ranges, or hold updates based on supply-chain risk signals.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-lime-500/30 bg-lime-400/10 px-4 py-3 text-sm text-lime-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total advice" value={advice.length} accent />
        <Stat label="Pin exact" value={stats.pin} hint="Lock to a known-good version" />
        <Stat label="Tighten range" value={stats.range} hint="Narrow caret/tilde ranges" />
        <Stat label="Hold / avoid" value={stats.hold} hint="Block until reviewed" />
      </div>

      {/* Generate */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-100">Generate Advice</h2>
        </CardHeader>
        <CardBody>
          {projects.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No projects in this workspace yet. Add a project to generate pinning advice.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium uppercase tracking-wide text-neutral-500">Project</label>
                <select
                  value={genProject}
                  onChange={(e) => setGenProject(e.target.value)}
                  className="min-w-56 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
                >
                  <option value="">Select a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.ecosystem ? ` (${p.ecosystem})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={handleGenerate} disabled={!genProject || generating}>
                {generating ? 'Generating...' : 'Generate advice'}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search package, version, rationale…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-56 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
        />
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={recFilter}
          onChange={(e) => setRecFilter(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
        >
          <option value="all">All recommendations</option>
          {recCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Advice table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={advice.length === 0 ? 'No pinning advice yet' : 'No advice matches your filters'}
          description={
            advice.length === 0
              ? 'Pick a project above and generate advice to get per-package pin/range recommendations.'
              : 'Try clearing the search or recommendation filter.'
          }
        />
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Package</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Recommendation</th>
                <th className="px-4 py-3 font-medium">Suggested</th>
                <th className="px-4 py-3 font-medium">Rationale</th>
                <th className="px-4 py-3 font-medium text-right">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map((a) => {
                const meta = recommendationMeta(a.recommendation)
                return (
                  <tr key={a.id} className="hover:bg-neutral-900/60">
                    <td className="px-4 py-3 font-medium text-neutral-200">
                      {a.package_name ?? a.package ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{a.project_name ?? projectName(a.project_id)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-lime-300">{a.suggested_version ?? '—'}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-neutral-400" title={a.rationale ?? ''}>
                      {a.rationale ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" onClick={() => setDetail(a)}>
                        View
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? (detail.package_name ?? detail.package ?? 'Pinning advice') : 'Pinning advice'}
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={recommendationMeta(detail.recommendation).tone}>
                {recommendationMeta(detail.recommendation).label}
              </Badge>
              {detail.suggested_version && (
                <span className="font-mono text-xs text-lime-300">→ {detail.suggested_version}</span>
              )}
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Project</div>
              <div className="mt-0.5 text-neutral-200">{detail.project_name ?? projectName(detail.project_id)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Rationale</div>
              <p className="mt-0.5 whitespace-pre-wrap text-neutral-300">{detail.rationale ?? 'No rationale provided.'}</p>
            </div>
            {detail.patch_snippet && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Patch snippet</div>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(detail.patch_snippet ?? '')}
                    className="text-xs text-lime-300 hover:text-lime-200"
                  >
                    Copy
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
                  {detail.patch_snippet}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
