'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

// ---- Types (defensive; backend may join extra fields) ----------------------

interface UpdateDetail {
  id: string
  workspace_id: string
  project_id: string
  package_id: string
  from_version: string
  to_version: string
  ecosystem: string
  bump_type: string
  source: string
  source_pr_url?: string | null
  status: string
  assigned_to?: string | null
  created_by?: string
  created_at?: string
  updated_at?: string
  // joined extras
  package_name?: string
  project_name?: string
  grade?: string | null
  total_score?: number | null
}

interface RiskScore {
  id?: string
  update_id?: string
  total_score: number
  grade: string
  confidence?: number
  breakdown?: Array<{ factor: string; raw: number; sub_score: number; weight: number; contribution: number }>
  computed_at?: string
}

interface RiskFactor {
  id?: string
  update_id?: string
  factor_type: string
  raw_value: number
  sub_score: number
  weight: number
  contribution: number
  detail?: Record<string, unknown>
}

interface ScriptDiff {
  added_scripts?: Record<string, string>
  removed_scripts?: Record<string, string>
  changed_scripts?: Record<string, { from: string; to: string }>
  has_new_install_hook?: boolean
  fetches_remote?: boolean
  obfuscation_suspect?: boolean
  native_build_hook?: boolean
}

interface DependencyDelta {
  added?: Array<{ name: string; version: string }>
  removed?: Array<{ name: string; version: string }>
  range_widened?: Array<{ name: string; from: string; to: string }>
  blast_radius?: number
}

interface PolicyEvaluation {
  id?: string
  rule_type: string
  passed: boolean
  message?: string
  created_at?: string
}

// ---- Helpers ----------------------------------------------------------------

const STATUS_TONE: Record<string, 'lime' | 'amber' | 'red' | 'blue' | 'green' | 'neutral'> = {
  pending: 'amber',
  needs_review: 'blue',
  approved: 'green',
  rejected: 'red',
  blocked: 'red',
  cleared: 'green',
}

const TRANSITIONS: Array<{ status: string; label: string; variant: 'primary' | 'secondary' | 'danger' | 'ghost' }> = [
  { status: 'approved', label: 'Approve', variant: 'primary' },
  { status: 'needs_review', label: 'Needs review', variant: 'secondary' },
  { status: 'rejected', label: 'Reject', variant: 'danger' },
  { status: 'blocked', label: 'Block', variant: 'danger' },
]

function fmtDate(s?: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function humanize(s: string) {
  return s
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function factorTone(contribution: number): 'red' | 'amber' | 'lime' | 'green' {
  if (contribution >= 15) return 'red'
  if (contribution >= 7) return 'amber'
  if (contribution >= 2) return 'lime'
  return 'green'
}

function barColor(contribution: number): string {
  if (contribution >= 15) return 'bg-red-500'
  if (contribution >= 7) return 'bg-amber-400'
  if (contribution >= 2) return 'bg-pink-400'
  return 'bg-emerald-500'
}

export default function UpdateDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [update, setUpdate] = useState<UpdateDetail | null>(null)
  const [risk, setRisk] = useState<RiskScore | null>(null)
  const [factors, setFactors] = useState<RiskFactor[]>([])
  const [scriptDiff, setScriptDiff] = useState<ScriptDiff | null>(null)
  const [depDelta, setDepDelta] = useState<DependencyDelta | null>(null)
  const [evals, setEvals] = useState<PolicyEvaluation[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [reevaluating, setReevaluating] = useState(false)
  const [runningPolicy, setRunningPolicy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [decision, setDecision] = useState<{ status: string; label: string } | null>(null)
  const [justification, setJustification] = useState('')
  const [deciding, setDeciding] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const upd: UpdateDetail = await api.getUpdate(id)
      setUpdate(upd)

      // These reads may legitimately 404 before grading completes; tolerate each.
      const [riskRes, factorsRes, sdRes, ddRes, evalRes] = await Promise.allSettled([
        api.getRisk(id),
        api.getRiskFactors(id),
        api.getScriptDiff(id),
        api.getDependencyDelta(id),
        api.getPolicyEvaluations(id),
      ])

      if (riskRes.status === 'fulfilled' && riskRes.value) {
        const v = riskRes.value
        // getRisk returns { score, factors } per the build contract.
        const score: RiskScore | null = v.score ?? (v.total_score != null ? v : null)
        setRisk(score)
        if ((!factorsRes || factorsRes.status !== 'fulfilled') && Array.isArray(v.factors)) {
          setFactors(v.factors)
        }
      }
      if (factorsRes.status === 'fulfilled' && Array.isArray(factorsRes.value)) {
        setFactors(factorsRes.value)
      }
      if (sdRes.status === 'fulfilled') setScriptDiff(sdRes.value ?? null)
      if (ddRes.status === 'fulfilled') setDepDelta(ddRes.value ?? null)
      if (evalRes.status === 'fulfilled' && Array.isArray(evalRes.value)) setEvals(evalRes.value)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load update')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const grade = risk?.grade ?? update?.grade ?? null
  const totalScore = risk?.total_score ?? update?.total_score ?? null

  const sortedFactors = useMemo(
    () => [...factors].sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0)),
    [factors]
  )
  const maxContribution = useMemo(
    () => Math.max(1, ...sortedFactors.map((f) => Math.abs(f.contribution ?? 0))),
    [sortedFactors]
  )

  const passedEvals = evals.filter((e) => e.passed).length
  const failedEvals = evals.filter((e) => !e.passed).length

  async function handleReevaluate() {
    if (!id) return
    setReevaluating(true)
    setActionError(null)
    try {
      await api.reevaluateUpdate(id)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Re-evaluation failed')
    } finally {
      setReevaluating(false)
    }
  }

  async function handleRunPolicy() {
    if (!id) return
    setRunningPolicy(true)
    setActionError(null)
    try {
      const res = await api.runPolicyEvaluation(id)
      if (Array.isArray(res)) setEvals(res)
      else await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Policy evaluation failed')
    } finally {
      setRunningPolicy(false)
    }
  }

  async function confirmDecision() {
    if (!id || !decision) return
    setDeciding(true)
    setActionError(null)
    try {
      const updated = await api.transitionUpdate(id, {
        status: decision.status,
        justification: justification.trim() || undefined,
      })
      if (updated && typeof updated === 'object') {
        setUpdate((prev) => (prev ? { ...prev, ...updated } : (updated as UpdateDetail)))
      }
      setDecision(null)
      setJustification('')
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setDeciding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading risk breakdown..." />

  if (error || !update) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⚠️"
          title="Could not load update"
          description={error ?? 'This update was not found.'}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
              <Link href="/dashboard/updates">
                <Button variant="ghost">Back to updates</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  const pkgName = update.package_name ?? update.package_id
  const projName = update.project_name ?? update.project_id

  return (
    <div className="mx-auto max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
        <Link href="/dashboard/updates" className="hover:text-pink-300">
          Updates
        </Link>
        <span>/</span>
        <span className="text-zinc-300">{pkgName}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-100">{pkgName}</h1>
            <Badge tone="neutral">{update.ecosystem}</Badge>
            <Badge tone={STATUS_TONE[update.status] ?? 'neutral'}>{humanize(update.status)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300">{update.from_version}</code>
            <span className="text-pink-400">→</span>
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-pink-300">{update.to_version}</code>
            <Badge tone="neutral">{update.bump_type} bump</Badge>
            <span className="text-zinc-600">·</span>
            <span>
              in{' '}
              <Link href={`/dashboard/projects/${update.project_id}`} className="text-zinc-200 hover:text-pink-300">
                {projName}
              </Link>
            </span>
            <span className="text-zinc-600">·</span>
            <span>via {update.source}</span>
          </div>
          {update.source_pr_url && (
            <a
              href={update.source_pr_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-pink-300 hover:underline"
            >
              View source PR ↗
            </a>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={handleReevaluate} disabled={reevaluating}>
            {reevaluating ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-4 w-4" /> Re-evaluating
              </span>
            ) : (
              'Re-evaluate'
            )}
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {/* Score summary */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="flex items-center gap-4 px-5 py-4">
          <GradeBadge grade={grade} className="text-2xl px-3 py-1" />
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Grade</div>
            <div className="text-sm text-zinc-400">{grade ? 'Risk grade' : 'Not yet graded'}</div>
          </div>
        </Card>
        <Stat
          label="Risk Score"
          value={totalScore != null ? totalScore.toFixed(1) : '-'}
          hint="0 = safe · 100 = severe"
          accent
        />
        <Stat
          label="Confidence"
          value={risk?.confidence != null ? `${Math.round(risk.confidence * 100)}%` : '-'}
        />
        <Stat
          label="Policy"
          value={evals.length === 0 ? '-' : `${passedEvals}/${evals.length}`}
          hint={failedEvals > 0 ? `${failedEvals} failing` : evals.length ? 'all pass' : 'not evaluated'}
        />
      </div>

      {/* Decision bar */}
      <Card className="mt-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Decision</div>
            <div className="text-xs text-zinc-500">
              Transitions are written to the tamper-evident decision ledger.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TRANSITIONS.map((t) => (
              <Button
                key={t.status}
                variant={t.variant}
                disabled={update.status === t.status}
                onClick={() => {
                  setDecision({ status: t.status, label: t.label })
                  setJustification('')
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Factor breakdown */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Risk factor breakdown</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Weighted sub-scores summed into the total. Larger bars contribute more risk.
          </p>
        </CardHeader>
        <CardBody>
          {sortedFactors.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500">
              No factor data yet. Run a re-evaluation to compute the breakdown.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Bars */}
              <div className="flex flex-col gap-2.5">
                {sortedFactors.map((f) => {
                  const pct = Math.min(100, (Math.abs(f.contribution ?? 0) / maxContribution) * 100)
                  return (
                    <div key={f.factor_type} className="flex items-center gap-3">
                      <div className="w-44 shrink-0 truncate text-xs text-zinc-300" title={humanize(f.factor_type)}>
                        {humanize(f.factor_type)}
                      </div>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full ${barColor(f.contribution ?? 0)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-300">
                        {(f.contribution ?? 0).toFixed(1)}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Detailed table */}
              <Table>
                <THead>
                  <TR>
                    <TH>Factor</TH>
                    <TH className="text-right">Raw</TH>
                    <TH className="text-right">Sub-score</TH>
                    <TH className="text-right">Weight</TH>
                    <TH className="text-right">Contribution</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedFactors.map((f) => (
                    <TR key={f.factor_type}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Badge tone={factorTone(f.contribution ?? 0)}>{humanize(f.factor_type)}</Badge>
                        </div>
                        {f.detail && Object.keys(f.detail).length > 0 && (
                          <div className="mt-1 text-xs text-zinc-600">
                            {Object.entries(f.detail)
                              .slice(0, 4)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(' · ')}
                          </div>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{(f.raw_value ?? 0).toFixed(2)}</TD>
                      <TD className="text-right tabular-nums">{(f.sub_score ?? 0).toFixed(2)}</TD>
                      <TD className="text-right tabular-nums">{(f.weight ?? 0).toFixed(2)}</TD>
                      <TD className="text-right font-medium tabular-nums text-zinc-100">
                        {(f.contribution ?? 0).toFixed(2)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Two-column: script diff + dependency delta */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Script diff */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Lifecycle script diff</h2>
            <p className="mt-0.5 text-xs text-zinc-500">New install hooks are a top vector for supply-chain attacks.</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {!scriptDiff ? (
              <p className="text-sm text-zinc-500">No script diff computed.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <FlagBadge active={scriptDiff.has_new_install_hook} label="New install hook" />
                  <FlagBadge active={scriptDiff.fetches_remote} label="Fetches remote" />
                  <FlagBadge active={scriptDiff.obfuscation_suspect} label="Obfuscation suspect" />
                  <FlagBadge active={scriptDiff.native_build_hook} label="Native build hook" tone="amber" />
                </div>

                <ScriptList title="Added" tone="red" entries={scriptDiff.added_scripts} />
                <ScriptList title="Removed" tone="neutral" entries={scriptDiff.removed_scripts} strike />
                {scriptDiff.changed_scripts && Object.keys(scriptDiff.changed_scripts).length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Changed</div>
                    <div className="flex flex-col gap-2">
                      {Object.entries(scriptDiff.changed_scripts).map(([k, v]) => (
                        <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
                          <div className="font-medium text-zinc-300">{k}</div>
                          <div className="mt-1 font-mono text-red-300/80 line-through">{v.from}</div>
                          <div className="font-mono text-pink-300">{v.to}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!scriptDiff.has_new_install_hook &&
                  (!scriptDiff.added_scripts || Object.keys(scriptDiff.added_scripts).length === 0) &&
                  (!scriptDiff.changed_scripts || Object.keys(scriptDiff.changed_scripts).length === 0) && (
                    <p className="text-sm text-emerald-300">No lifecycle script changes detected.</p>
                  )}
              </>
            )}
          </CardBody>
        </Card>

        {/* Dependency delta */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Dependency delta</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Transitive changes introduced by this bump.</p>
            </div>
            {depDelta?.blast_radius != null && (
              <Badge tone={depDelta.blast_radius > 10 ? 'red' : depDelta.blast_radius > 3 ? 'amber' : 'lime'}>
                blast radius {depDelta.blast_radius}
              </Badge>
            )}
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            {!depDelta ? (
              <p className="text-sm text-zinc-500">No dependency delta computed.</p>
            ) : (
              <>
                <DeltaList
                  title="Added"
                  tone="amber"
                  items={(depDelta.added ?? []).map((d) => `${d.name}@${d.version}`)}
                />
                <DeltaList
                  title="Removed"
                  tone="neutral"
                  items={(depDelta.removed ?? []).map((d) => `${d.name}@${d.version}`)}
                />
                {depDelta.range_widened && depDelta.range_widened.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Range widened
                    </div>
                    <div className="flex flex-col gap-1">
                      {depDelta.range_widened.map((r) => (
                        <div key={r.name} className="flex items-center gap-2 text-xs">
                          <span className="text-zinc-300">{r.name}</span>
                          <code className="rounded bg-zinc-900 px-1 text-zinc-400">{r.from}</code>
                          <span className="text-amber-400">→</span>
                          <code className="rounded bg-zinc-900 px-1 text-amber-300">{r.to}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(depDelta.added ?? []).length === 0 &&
                  (depDelta.removed ?? []).length === 0 &&
                  (depDelta.range_widened ?? []).length === 0 && (
                    <p className="text-sm text-emerald-300">No dependency tree changes.</p>
                  )}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Policy evaluations */}
      <Card className="mt-6">
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Policy evaluation</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Rule pass/fail against the workspace default policy.</p>
          </div>
          <Button variant="secondary" onClick={handleRunPolicy} disabled={runningPolicy}>
            {runningPolicy ? (
              <span className="flex items-center gap-2">
                <Spinner className="h-4 w-4" /> Running
              </span>
            ) : (
              'Run policy'
            )}
          </Button>
        </CardHeader>
        <CardBody>
          {evals.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">
              No policy evaluation yet. Run the workspace default policy against this update.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {evals.map((ev, i) => (
                <div
                  key={ev.id ?? `${ev.rule_type}-${i}`}
                  className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3"
                >
                  <Badge tone={ev.passed ? 'green' : 'red'}>{ev.passed ? 'PASS' : 'FAIL'}</Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-200">{humanize(ev.rule_type)}</div>
                    {ev.message && <div className="mt-0.5 text-xs text-zinc-500">{ev.message}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Metadata */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Metadata</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Meta label="Status" value={<Badge tone={STATUS_TONE[update.status] ?? 'neutral'}>{humanize(update.status)}</Badge>} />
            <Meta label="Assigned to" value={update.assigned_to || <span className="text-zinc-600">Unassigned</span>} />
            <Meta label="Source" value={update.source} />
            <Meta label="Created" value={fmtDate(update.created_at)} />
            <Meta label="Updated" value={fmtDate(update.updated_at)} />
            <Meta label="Computed at" value={fmtDate(risk?.computed_at)} />
          </dl>
        </CardBody>
      </Card>

      {/* Decision modal */}
      <Modal
        open={decision != null}
        onClose={() => {
          if (!deciding) {
            setDecision(null)
            setActionError(null)
          }
        }}
        title={`${decision?.label} update`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={deciding}>
              Cancel
            </Button>
            <Button
              variant={decision?.status === 'rejected' || decision?.status === 'blocked' ? 'danger' : 'primary'}
              onClick={confirmDecision}
              disabled={deciding}
            >
              {deciding ? 'Recording...' : `Confirm ${decision?.label}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Transition <span className="font-semibold text-zinc-100">{pkgName}</span> ({update.from_version} →{' '}
          {update.to_version}) to{' '}
          <span className="font-semibold text-pink-300">{decision && humanize(decision.status)}</span>.
        </p>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Justification <span className="font-normal normal-case text-zinc-600">(recorded in ledger)</span>
          </span>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder="Why are you making this decision?"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-pink-500/50 focus:outline-none"
          />
        </label>
        {actionError && <p className="mt-3 text-sm text-red-300">{actionError}</p>}
      </Modal>
    </div>
  )
}

// ---- Small presentational helpers -------------------------------------------

function FlagBadge({ active, label, tone = 'red' }: { active?: boolean; label: string; tone?: 'red' | 'amber' }) {
  if (!active) return <Badge tone="green">No {label.toLowerCase()}</Badge>
  return <Badge tone={tone}>⚠ {label}</Badge>
}

function ScriptList({
  title,
  tone,
  entries,
  strike,
}: {
  title: string
  tone: 'red' | 'neutral'
  entries?: Record<string, string>
  strike?: boolean
}) {
  if (!entries || Object.keys(entries).length === 0) return null
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</span>
        <Badge tone={tone}>{Object.keys(entries).length}</Badge>
      </div>
      <div className="flex flex-col gap-1">
        {Object.entries(entries).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs">
            <span className="font-medium text-zinc-300">{k}</span>
            <span className="mx-1 text-zinc-600">:</span>
            <span className={`font-mono ${strike ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeltaList({ title, tone, items }: { title: string; tone: 'amber' | 'neutral'; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</span>
        <Badge tone={tone}>{items.length}</Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <code key={it} className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300">
            {it}
          </code>
        ))}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-800/60 pb-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-200">{value}</dd>
    </div>
  )
}
