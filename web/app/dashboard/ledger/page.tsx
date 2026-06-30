'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface LedgerEntry {
  id: string
  workspace_id?: string
  update_id?: string
  decision: string
  grade_at_decision?: string | null
  score_at_decision?: number | null
  actor_id?: string | null
  justification?: string | null
  policy_result?: unknown
  factors_snapshot?: unknown
  prev_hash?: string | null
  entry_hash?: string | null
  created_at?: string
  package_name?: string
  package?: string
  from_version?: string
  to_version?: string
}

interface VerifyResult {
  valid: boolean
  broken_at?: string | null
}

function decisionTone(d?: string): { tone: 'green' | 'lime' | 'amber' | 'red' | 'neutral'; label: string } {
  const x = (d ?? '').toLowerCase()
  if (x.includes('approve') || x.includes('clear') || x.includes('accept')) return { tone: 'green', label: d ?? 'Approved' }
  if (x.includes('reject') || x.includes('block') || x.includes('deny')) return { tone: 'red', label: d ?? 'Rejected' }
  if (x.includes('review') || x.includes('hold')) return { tone: 'amber', label: d ?? 'Needs review' }
  return { tone: 'neutral', label: d ?? 'Recorded' }
}

function shortHash(h?: string | null) {
  if (!h) return '—'
  return h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h
}

function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString()
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function LedgerPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [packageFilter, setPackageFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [detail, setDetail] = useState<LedgerEntry | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const loadEntries = useCallback(async (wsId: string, pkg: string, actor: string) => {
    const params: { workspace_id?: string; package?: string; actor?: string } = { workspace_id: wsId }
    if (pkg) params.package = pkg
    if (actor) params.actor = actor
    const rows = await api.listLedger(params)
    setEntries(Array.isArray(rows) ? rows : [])
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
      await loadEntries(ws.id, '', '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load decision ledger')
    } finally {
      setLoading(false)
    }
  }, [loadEntries])

  useEffect(() => {
    load()
  }, [load])

  async function applyServerFilters() {
    if (!workspaceId) return
    setError(null)
    try {
      await loadEntries(workspaceId, packageFilter.trim(), actorFilter.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to filter ledger')
    }
  }

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (decisionFilter !== 'all') {
        if ((e.decision ?? '').toLowerCase() !== decisionFilter.toLowerCase()) return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay =
          `${e.package_name ?? e.package ?? ''} ${e.actor_id ?? ''} ${e.justification ?? ''} ${e.decision ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, decisionFilter, search])

  const decisionTypes = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) if (e.decision) set.add(e.decision)
    return Array.from(set)
  }, [entries])

  const stats = useMemo(() => {
    const counts = { approved: 0, rejected: 0, review: 0, other: 0 }
    for (const e of entries) {
      const t = decisionTone(e.decision).tone
      if (t === 'green') counts.approved++
      else if (t === 'red') counts.rejected++
      else if (t === 'amber') counts.review++
      else counts.other++
    }
    return counts
  }, [entries])

  async function handleVerify() {
    if (!workspaceId) return
    setVerifying(true)
    setError(null)
    try {
      const res: VerifyResult = await api.verifyLedger(workspaceId)
      setVerify(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to verify ledger integrity')
    } finally {
      setVerifying(false)
    }
  }

  async function handleExport(format: 'json' | 'csv') {
    if (!workspaceId) return
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.exportLedger({ workspace_id: workspaceId, format })
      if (format === 'csv') {
        const csv = typeof res === 'string' ? res : (res?.csv ?? '')
        download('ledger.csv', csv, 'text/csv')
      } else {
        const json = res?.json ?? res
        download('ledger.json', JSON.stringify(json, null, 2), 'application/json')
      }
      setNotice(`Exported ledger as ${format.toUpperCase()}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export ledger')
    } finally {
      setExporting(false)
    }
  }

  async function openDetail(id: string) {
    setDetailLoading(true)
    setError(null)
    try {
      const full: LedgerEntry = await api.getLedgerEntry(id)
      setDetail(full)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger entry')
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading) return <PageSpinner label="Loading decision ledger..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <EmptyState
          title="No workspace found"
          description="Create a workspace and make some triage decisions to populate the ledger."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Decision Ledger</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Tamper-evident, hash-chained record of every approve / reject / hold decision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => handleExport('csv')} disabled={exporting}>
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => handleExport('json')} disabled={exporting}>
            Export JSON
          </Button>
          <Button onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Verifying...' : 'Verify integrity'}
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

      {/* Integrity banner */}
      {verify && (
        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
            verify.valid
              ? 'border-lime-500/30 bg-lime-400/10 text-lime-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          <span className="text-lg">{verify.valid ? '✓' : '✕'}</span>
          {verify.valid ? (
            <span>Hash chain verified. All {entries.length} entries are intact and untampered.</span>
          ) : (
            <span>
              Integrity check FAILED. Chain breaks at entry{' '}
              <span className="font-mono">{verify.broken_at ?? 'unknown'}</span>.
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total entries" value={entries.length} accent />
        <Stat label="Approved" value={stats.approved} />
        <Stat label="Rejected" value={stats.rejected} />
        <Stat label="Needs review" value={stats.review} />
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <input
            type="search"
            placeholder="Search package, actor, justification…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-56 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
          />
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Package</label>
            <input
              type="text"
              placeholder="package name"
              value={packageFilter}
              onChange={(e) => setPackageFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyServerFilters()}
              className="w-40 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">Actor</label>
            <input
              type="text"
              placeholder="actor id"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyServerFilters()}
              className="w-40 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500 focus:outline-none"
          >
            <option value="all">All decisions</option>
            {decisionTypes.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={applyServerFilters}>
            Apply
          </Button>
        </CardBody>
      </Card>

      {/* Ledger table */}
      {filtered.length === 0 ? (
        <EmptyState
          title={entries.length === 0 ? 'Ledger is empty' : 'No entries match your filters'}
          description={
            entries.length === 0
              ? 'Approve or reject updates in the triage queue to write hash-chained ledger entries.'
              : 'Try clearing the search or filters above.'
          }
        />
      ) : (
        <div className="w-full overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900/80 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Package</th>
                <th className="px-4 py-3 font-medium">Decision</th>
                <th className="px-4 py-3 font-medium text-center">Grade</th>
                <th className="px-4 py-3 font-medium text-right">Score</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Hash</th>
                <th className="px-4 py-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map((e) => {
                const meta = decisionTone(e.decision)
                return (
                  <tr key={e.id} className="hover:bg-neutral-900/60">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{fmtDate(e.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-neutral-200">
                      <div>{e.package_name ?? e.package ?? '—'}</div>
                      {(e.from_version || e.to_version) && (
                        <div className="font-mono text-[11px] text-neutral-500">
                          {e.from_version ?? '?'} → {e.to_version ?? '?'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <GradeBadge grade={e.grade_at_decision} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                      {typeof e.score_at_decision === 'number' ? e.score_at_decision.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{e.actor_id ?? 'system'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-neutral-500" title={e.entry_hash ?? ''}>
                      {shortHash(e.entry_hash)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" onClick={() => openDetail(e.id)} disabled={detailLoading}>
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
        title="Ledger entry"
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={decisionTone(detail.decision).tone}>{decisionTone(detail.decision).label}</Badge>
              <GradeBadge grade={detail.grade_at_decision} />
              {typeof detail.score_at_decision === 'number' && (
                <span className="text-xs text-neutral-400">score {detail.score_at_decision.toFixed(1)}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Package</div>
                <div className="mt-0.5 text-neutral-200">{detail.package_name ?? detail.package ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Actor</div>
                <div className="mt-0.5 text-neutral-200">{detail.actor_id ?? 'system'}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">When</div>
                <div className="mt-0.5 text-neutral-200">{fmtDate(detail.created_at)}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Update</div>
                <div className="mt-0.5 font-mono text-xs text-neutral-400">{detail.update_id ?? '—'}</div>
              </div>
            </div>

            {detail.justification && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Justification</div>
                <p className="mt-0.5 whitespace-pre-wrap text-neutral-300">{detail.justification}</p>
              </div>
            )}

            <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Hash chain</div>
              <div className="mt-1 space-y-1 font-mono text-[11px] text-neutral-400">
                <div>
                  <span className="text-neutral-600">prev:</span> {detail.prev_hash ?? '(genesis)'}
                </div>
                <div className="break-all">
                  <span className="text-neutral-600">this:</span> <span className="text-lime-300">{detail.entry_hash ?? '—'}</span>
                </div>
              </div>
            </div>

            {detail.policy_result != null && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Policy result</div>
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] text-neutral-300">
                  {JSON.stringify(detail.policy_result, null, 2)}
                </pre>
              </div>
            )}

            {detail.factors_snapshot != null && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Factors snapshot</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] text-neutral-300">
                  {JSON.stringify(detail.factors_snapshot, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
