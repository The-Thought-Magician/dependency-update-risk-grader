'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

type Weights = Record<string, number>
type GradeBands = Record<string, number>

interface PreviewRow {
  update_id?: string
  package?: string
  package_name?: string
  from_version?: string
  to_version?: string
  total_score?: number
  score?: number
  grade?: string
  old_grade?: string
  new_grade?: string
}

interface RulesResponse {
  weights: Weights
  grade_bands: GradeBands
  auto_clear_max_grade?: string | null
  preview?: PreviewRow[]
}

// Human labels for the canonical risk factors. Unknown keys fall back to a
// prettified version of the key so the UI never breaks if the backend adds one.
const FACTOR_LABELS: Record<string, string> = {
  maintainer_change: 'Maintainer Change',
  maintainer_trust: 'Maintainer Trust',
  publish_cadence: 'Publish Cadence',
  install_scripts: 'Install Scripts',
  script_diff: 'Lifecycle Script Diff',
  dependency_delta: 'Dependency Delta',
  blast_radius: 'Blast Radius',
  provenance: 'Provenance / SLSA',
  signature: 'Signature & 2FA',
  reputation: 'Package Reputation',
  download_trend: 'Download Trend',
  typosquat: 'Typosquat Signal',
  deprecation: 'Deprecation / Archived',
  bump_type: 'Bump Type',
  age: 'Version Age',
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']

function prettyKey(k: string) {
  return FACTOR_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function gradeTone(g?: string) {
  const x = (g ?? '').toUpperCase()
  if (x === 'A') return 'green' as const
  if (x === 'B') return 'lime' as const
  if (x === 'C' || x === 'D') return 'amber' as const
  if (x === 'F') return 'red' as const
  return 'neutral' as const
}

export default function RulesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [savedWeights, setSavedWeights] = useState<Weights>({})
  const [savedBands, setSavedBands] = useState<GradeBands>({})
  const [savedAutoClear, setSavedAutoClear] = useState<string>('')

  const [weights, setWeights] = useState<Weights>({})
  const [bands, setBands] = useState<GradeBands>({})
  const [autoClear, setAutoClear] = useState<string>('')

  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const applyResponse = useCallback((data: RulesResponse) => {
    const w = data.weights ?? {}
    const b = data.grade_bands ?? {}
    const ac = data.auto_clear_max_grade ?? ''
    setSavedWeights(w)
    setSavedBands(b)
    setSavedAutoClear(ac)
    setWeights({ ...w })
    setBands({ ...b })
    setAutoClear(ac)
    if (data.preview) setPreview(data.preview)
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
      const data: RulesResponse = await api.getRules(ws.id)
      applyResponse(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load risk rules')
    } finally {
      setLoading(false)
    }
  }, [applyResponse])

  useEffect(() => {
    load()
  }, [load])

  const dirty = useMemo(() => {
    const wChanged = Object.keys({ ...savedWeights, ...weights }).some(
      (k) => Number(savedWeights[k] ?? 0) !== Number(weights[k] ?? 0),
    )
    const bChanged = Object.keys({ ...savedBands, ...bands }).some(
      (k) => Number(savedBands[k] ?? 0) !== Number(bands[k] ?? 0),
    )
    return wChanged || bChanged || autoClear !== savedAutoClear
  }, [weights, bands, autoClear, savedWeights, savedBands, savedAutoClear])

  const weightTotal = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0),
    [weights],
  )

  const orderedBands = useMemo(() => {
    const keys = Object.keys(bands)
    return keys.sort((a, b) => {
      const ia = GRADE_ORDER.indexOf(a.toUpperCase())
      const ib = GRADE_ORDER.indexOf(b.toUpperCase())
      if (ia === -1 && ib === -1) return a.localeCompare(b)
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }, [bands])

  const previewDist = useMemo(() => {
    const dist: Record<string, number> = {}
    for (const r of preview) {
      const g = (r.new_grade ?? r.grade ?? '?').toUpperCase()
      dist[g] = (dist[g] ?? 0) + 1
    }
    return dist
  }, [preview])

  const previewTotal = preview.length

  function setWeight(key: string, value: number) {
    setWeights((w) => ({ ...w, [key]: value }))
  }

  function setBand(key: string, value: number) {
    setBands((b) => ({ ...b, [key]: value }))
  }

  async function handleSave() {
    if (!workspaceId) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const body = {
        workspace_id: workspaceId,
        weights,
        grade_bands: bands,
        auto_clear_max_grade: autoClear || null,
      }
      const data: RulesResponse = await api.updateRules(body)
      applyResponse(data)
      setNotice('Risk rules saved and updates re-scored.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save rules')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!workspaceId) return
    if (!confirm('Reset all risk weights and grade bands to platform defaults?')) return
    setResetting(true)
    setError(null)
    setNotice(null)
    try {
      const data: RulesResponse = await api.resetRules({ workspace_id: workspaceId })
      applyResponse(data)
      setNotice('Reset to default weights and grade bands.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset rules')
    } finally {
      setResetting(false)
    }
  }

  function handleRevert() {
    setWeights({ ...savedWeights })
    setBands({ ...savedBands })
    setAutoClear(savedAutoClear)
    setNotice(null)
  }

  if (loading) return <PageSpinner label="Loading risk rules..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          title="No workspace found"
          description="Create a workspace before configuring risk weights and grade bands."
        />
      </div>
    )
  }

  const weightKeys = Object.keys(weights)

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Risk Rules</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Tune factor weights and grade-band thresholds. Saving re-scores every update in the workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={handleRevert} disabled={!dirty || saving || resetting}>
            Revert
          </Button>
          <Button variant="secondary" onClick={handleReset} disabled={resetting || saving}>
            {resetting ? 'Resetting...' : 'Reset to defaults'}
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving || resetting}>
            {saving ? 'Saving...' : 'Save & re-score'}
          </Button>
        </div>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Factors weighted" value={weightKeys.length} />
        <Stat
          label="Weight total"
          value={weightTotal.toFixed(2)}
          accent
          hint={dirty ? 'Unsaved changes' : 'In sync with backend'}
        />
        <Stat
          label="Auto-clear ceiling"
          value={autoClear ? <GradeBadge grade={autoClear} /> : 'Off'}
          hint="Updates at or below this grade auto-approve"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weights editor */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-100">Factor Weights</h2>
              <Badge tone="neutral">{weightKeys.length} factors</Badge>
            </div>
          </CardHeader>
          <CardBody className="space-y-5">
            {weightKeys.length === 0 && (
              <p className="text-sm text-neutral-500">No risk factors are configured for this workspace.</p>
            )}
            {weightKeys.map((key) => {
              const value = Number(weights[key] ?? 0)
              const share = weightTotal > 0 ? (value / weightTotal) * 100 : 0
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-200">{prettyKey(key)}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="10"
                        value={value}
                        onChange={(e) => setWeight(key, Number(e.target.value))}
                        className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
                      />
                      <span className="w-12 text-right text-xs text-neutral-500">{share.toFixed(0)}%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.05"
                    value={value}
                    onChange={(e) => setWeight(key, Number(e.target.value))}
                    className="w-full accent-lime-400"
                  />
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div className="h-full rounded-full bg-lime-400/70" style={{ width: `${Math.min(100, share)}%` }} />
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>

        {/* Grade bands + auto-clear */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-100">Grade Bands</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs text-neutral-500">
                Minimum total score required to earn each grade. Higher score means higher risk; a score at or above a
                band&apos;s threshold lands in that grade.
              </p>
              {orderedBands.length === 0 && (
                <p className="text-sm text-neutral-500">No grade bands configured.</p>
              )}
              {orderedBands.map((g) => (
                <div key={g} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GradeBadge grade={g} />
                    <span className="text-sm text-neutral-300">threshold</span>
                  </div>
                  <input
                    type="number"
                    step="1"
                    value={Number(bands[g] ?? 0)}
                    onChange={(e) => setBand(g, Number(e.target.value))}
                    className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
                  />
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-100">Auto-clear Ceiling</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-neutral-500">
                Updates graded at or below this ceiling are auto-approved during triage. Leave off to require manual
                review for everything.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAutoClear('')}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    autoClear === ''
                      ? 'border-lime-500/40 bg-lime-400/10 text-lime-300'
                      : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                  }`}
                >
                  Off
                </button>
                {GRADE_ORDER.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setAutoClear(g)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      autoClear === g
                        ? 'border-lime-500/40 bg-lime-400/10 text-lime-300'
                        : 'border-neutral-700 text-neutral-400 hover:bg-neutral-800'
                    }`}
                  >
                    {g} or safer
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-100">Live Re-score Preview</h2>
            <span className="text-xs text-neutral-500">
              {previewTotal > 0
                ? `${previewTotal} update${previewTotal === 1 ? '' : 's'} re-scored on last save`
                : 'Save to compute a fresh preview'}
            </span>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          {previewTotal === 0 ? (
            <EmptyState
              title="No preview yet"
              description="Adjust weights or grade bands, then Save & re-score to see how every update would re-grade."
            />
          ) : (
            <>
              {/* Grade distribution bars */}
              <div className="space-y-2">
                {GRADE_ORDER.map((g) => {
                  const count = previewDist[g] ?? 0
                  const pct = previewTotal > 0 ? (count / previewTotal) * 100 : 0
                  return (
                    <div key={g} className="flex items-center gap-3">
                      <div className="w-8">
                        <GradeBadge grade={g} />
                      </div>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-800">
                        <div
                          className={`h-full rounded-full ${
                            g === 'F'
                              ? 'bg-red-500/70'
                              : g === 'C' || g === 'D'
                                ? 'bg-amber-400/70'
                                : 'bg-lime-400/70'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-16 text-right text-xs text-neutral-400">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Per-update preview table */}
              <div className="w-full overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Package</th>
                      <th className="px-4 py-3 font-medium">Bump</th>
                      <th className="px-4 py-3 font-medium text-right">Score</th>
                      <th className="px-4 py-3 font-medium text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {preview.slice(0, 50).map((r, i) => {
                      const newGrade = r.new_grade ?? r.grade
                      const oldGrade = r.old_grade
                      const changed = oldGrade != null && oldGrade.toUpperCase() !== (newGrade ?? '').toUpperCase()
                      const score = r.total_score ?? r.score
                      return (
                        <tr key={r.update_id ?? i} className="hover:bg-neutral-900/60">
                          <td className="px-4 py-3 font-medium text-neutral-200">
                            {r.package ?? r.package_name ?? r.update_id ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-neutral-400">
                            {r.from_version || r.to_version
                              ? `${r.from_version ?? '?'} → ${r.to_version ?? '?'}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                            {typeof score === 'number' ? score.toFixed(1) : '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {changed && (
                                <>
                                  <Badge tone={gradeTone(oldGrade)} className="opacity-50">
                                    {oldGrade}
                                  </Badge>
                                  <span className="text-neutral-600">→</span>
                                </>
                              )}
                              <GradeBadge grade={newGrade} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {preview.length > 50 && (
                <p className="text-center text-xs text-neutral-600">
                  Showing first 50 of {preview.length} re-scored updates.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
