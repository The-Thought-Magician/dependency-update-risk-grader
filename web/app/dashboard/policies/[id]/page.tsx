'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Policy {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  weights?: Record<string, number> | null
  grade_bands?: Record<string, number> | null
  auto_clear_max_grade?: string | null
  is_default?: boolean | null
  updated_at?: string | null
}

interface PolicyDetail extends Policy {
  rules?: PolicyRule[]
}

interface PolicyRule {
  id: string
  policy_id: string
  rule_type: string
  threshold?: number | null
  action: string
  enabled: boolean
  config?: Record<string, unknown> | null
  created_at?: string | null
}

interface SimResultRow {
  update_id?: string
  package?: string
  package_name?: string
  from_version?: string
  to_version?: string
  grade?: string
  score?: number
  passed?: boolean
  action?: string
  message?: string
}

interface SimResponse {
  results?: SimResultRow[]
  summary?: Record<string, number>
}

const DEFAULT_WEIGHT_FACTORS = [
  'maintainer_change',
  'install_scripts',
  'publish_cadence',
  'provenance',
  'blast_radius',
  'reputation',
  'version_jump',
  'deprecation',
]

const RULE_TYPES = [
  'block_install_scripts',
  'require_provenance',
  'block_new_maintainer',
  'max_grade',
  'min_trust_score',
  'block_deprecated',
  'block_typosquat',
  'max_blast_radius',
]

const RULE_ACTIONS = ['block', 'flag', 'require_review', 'allow']

const GRADE_BAND_KEYS = ['A', 'B', 'C', 'D', 'F']

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function actionTone(a?: string): 'red' | 'amber' | 'blue' | 'green' | 'neutral' {
  if (a === 'block') return 'red'
  if (a === 'flag') return 'amber'
  if (a === 'require_review') return 'blue'
  if (a === 'allow') return 'green'
  return 'neutral'
}

function gradeTone(g?: string | null): 'green' | 'lime' | 'amber' | 'red' | 'neutral' {
  const u = (g ?? '').toUpperCase()
  if (u === 'A') return 'green'
  if (u === 'B') return 'lime'
  if (u === 'C' || u === 'D') return 'amber'
  if (u === 'F') return 'red'
  return 'neutral'
}

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [policy, setPolicy] = useState<PolicyDetail | null>(null)
  const [rules, setRules] = useState<PolicyRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable policy fields
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [autoClear, setAutoClear] = useState<string>('B')
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [bands, setBands] = useState<Record<string, number>>({})
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policySaveMsg, setPolicySaveMsg] = useState<string | null>(null)

  // Rule modal
  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<PolicyRule | null>(null)
  const [ruleType, setRuleType] = useState(RULE_TYPES[0])
  const [ruleThreshold, setRuleThreshold] = useState('')
  const [ruleAction, setRuleAction] = useState('block')
  const [ruleEnabled, setRuleEnabled] = useState(true)
  const [savingRule, setSavingRule] = useState(false)
  const [ruleError, setRuleError] = useState<string | null>(null)

  const [deleteRuleTarget, setDeleteRuleTarget] = useState<PolicyRule | null>(null)

  // Simulation
  const [simRunning, setSimRunning] = useState(false)
  const [sim, setSim] = useState<SimResponse | null>(null)
  const [simError, setSimError] = useState<string | null>(null)

  function hydrate(p: PolicyDetail, ruleList: PolicyRule[]) {
    setPolicy(p)
    setName(p.name ?? '')
    setDescription(p.description ?? '')
    setAutoClear(p.auto_clear_max_grade ?? 'B')
    const w: Record<string, number> = {}
    for (const f of DEFAULT_WEIGHT_FACTORS) w[f] = 0
    if (p.weights) for (const [k, v] of Object.entries(p.weights)) w[k] = Number(v) || 0
    setWeights(w)
    setBands(p.grade_bands ? { ...p.grade_bands } : {})
    setRules(ruleList)
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, r] = await Promise.all([api.getPolicy(id), api.listPolicyRules(id)])
      const ruleList = Array.isArray(r) ? r : Array.isArray(p?.rules) ? p.rules : []
      hydrate(p, ruleList)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const weightTotal = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0),
    [weights],
  )

  async function savePolicy() {
    setSavingPolicy(true)
    setPolicySaveMsg(null)
    try {
      const updated: PolicyDetail = await api.updatePolicy(id, {
        name: name.trim(),
        description: description.trim() || null,
        auto_clear_max_grade: autoClear,
        weights,
        grade_bands: bands,
      })
      setPolicy((prev) => ({ ...(prev ?? ({} as PolicyDetail)), ...updated }))
      setPolicySaveMsg('Saved')
      setTimeout(() => setPolicySaveMsg(null), 2500)
    } catch (e) {
      setPolicySaveMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingPolicy(false)
    }
  }

  function setWeight(k: string, v: number) {
    setWeights((prev) => ({ ...prev, [k]: v }))
  }

  function setBand(k: string, v: number) {
    setBands((prev) => ({ ...prev, [k]: v }))
  }

  function openCreateRule() {
    setEditingRule(null)
    setRuleType(RULE_TYPES[0])
    setRuleThreshold('')
    setRuleAction('block')
    setRuleEnabled(true)
    setRuleError(null)
    setRuleModalOpen(true)
  }

  function openEditRule(r: PolicyRule) {
    setEditingRule(r)
    setRuleType(r.rule_type)
    setRuleThreshold(r.threshold == null ? '' : String(r.threshold))
    setRuleAction(r.action)
    setRuleEnabled(r.enabled)
    setRuleError(null)
    setRuleModalOpen(true)
  }

  async function submitRule(e: React.FormEvent) {
    e.preventDefault()
    setSavingRule(true)
    setRuleError(null)
    const body = {
      policy_id: id,
      rule_type: ruleType,
      threshold: ruleThreshold === '' ? null : Number(ruleThreshold),
      action: ruleAction,
      enabled: ruleEnabled,
    }
    try {
      if (editingRule) {
        const updated: PolicyRule = await api.updatePolicyRule(editingRule.id, body)
        setRules((prev) => prev.map((r) => (r.id === editingRule.id ? { ...r, ...updated } : r)))
      } else {
        const created: PolicyRule = await api.createPolicyRule(body)
        setRules((prev) => [...prev, created])
      }
      setRuleModalOpen(false)
    } catch (err) {
      setRuleError(err instanceof Error ? err.message : 'Failed to save rule')
    } finally {
      setSavingRule(false)
    }
  }

  async function toggleRuleEnabled(r: PolicyRule) {
    const next = !r.enabled
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)))
    try {
      await api.updatePolicyRule(r.id, {
        policy_id: id,
        rule_type: r.rule_type,
        threshold: r.threshold ?? null,
        action: r.action,
        enabled: next,
      })
    } catch {
      // revert on failure
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: r.enabled } : x)))
    }
  }

  async function confirmDeleteRule() {
    if (!deleteRuleTarget) return
    const target = deleteRuleTarget
    try {
      await api.deletePolicyRule(target.id)
      setRules((prev) => prev.filter((r) => r.id !== target.id))
      setDeleteRuleTarget(null)
    } catch (e) {
      setRuleError(e instanceof Error ? e.message : 'Failed to delete rule')
    }
  }

  async function runSimulation() {
    setSimRunning(true)
    setSimError(null)
    try {
      const res: SimResponse = await api.simulatePolicy(id, {
        weights,
        grade_bands: bands,
        auto_clear_max_grade: autoClear,
      })
      setSim(res)
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setSimRunning(false)
    }
  }

  const simResults = sim?.results ?? []
  const simStats = useMemo(() => {
    const total = simResults.length
    const blocked = simResults.filter((r) => r.action === 'block' || r.passed === false).length
    const flagged = simResults.filter((r) => r.action === 'flag' || r.action === 'require_review').length
    const cleared = total - blocked - flagged
    return { total, blocked, flagged, cleared }
  }, [simResults])

  if (loading) return <PageSpinner label="Loading policy..." />

  if (error || !policy) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/policies" className="text-sm text-neutral-400 hover:text-lime-300">
          ← Back to policies
        </Link>
        <EmptyState
          title="Could not load policy"
          description={error ?? 'Policy not found.'}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/policies" className="text-sm text-neutral-400 hover:text-lime-300">
          ← Back to policies
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-neutral-100">{policy.name}</h1>
          {policy.is_default && <Badge tone="lime">Default</Badge>}
          <Badge tone="neutral">Updated {fmtDate(policy.updated_at)}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: metadata + weights + bands */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200">Profile</h2>
              <div className="flex items-center gap-3">
                {policySaveMsg && (
                  <span
                    className={`text-xs ${
                      policySaveMsg === 'Saved' ? 'text-lime-300' : 'text-red-300'
                    }`}
                  >
                    {policySaveMsg}
                  </span>
                )}
                <Button onClick={savePolicy} disabled={savingPolicy}>
                  {savingPolicy ? <Spinner className="h-4 w-4" /> : 'Save changes'}
                </Button>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Auto-clear updates at or below grade
                </label>
                <div className="flex gap-2">
                  {GRADE_BAND_KEYS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setAutoClear(g)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                        autoClear === g
                          ? 'border-lime-500/40 bg-lime-400/15 text-lime-300'
                          : 'border-neutral-700 bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200">Risk factor weights</h2>
              <Badge tone={weightTotal === 0 ? 'red' : 'neutral'}>Total {weightTotal}</Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs text-neutral-500">
                Each factor contributes to the composite risk score in proportion to its weight.
                Set a weight to 0 to ignore a signal.
              </p>
              {Object.keys(weights).map((k) => {
                const v = weights[k] ?? 0
                const pct = weightTotal > 0 ? Math.round((v / weightTotal) * 100) : 0
                return (
                  <div key={k}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-neutral-300">{prettyKey(k)}</span>
                      <span className="flex items-center gap-2 text-xs text-neutral-500">
                        <span className="tabular-nums">{pct}%</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={v}
                          onChange={(e) => setWeight(k, Number(e.target.value))}
                          className="w-16 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-xs text-neutral-100 focus:border-lime-500/60 focus:outline-none"
                        />
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={v}
                      onChange={(e) => setWeight(k, Number(e.target.value))}
                      className="w-full accent-lime-400"
                    />
                  </div>
                )
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-200">Grade bands</h2>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-neutral-500">
                Minimum composite score required to earn each grade (0–100). Higher score means
                higher risk.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {GRADE_BAND_KEYS.map((g) => (
                  <div key={g} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={gradeTone(g)}>{g}</Badge>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={bands[g] ?? ''}
                      onChange={(e) => setBand(g, Number(e.target.value))}
                      placeholder="0"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 focus:border-lime-500/60 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right column: rules */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200">Gate rules ({rules.length})</h2>
              <Button variant="secondary" onClick={openCreateRule}>
                + Rule
              </Button>
            </CardHeader>
            <CardBody className="space-y-3">
              {rules.length === 0 ? (
                <EmptyState
                  title="No rules"
                  description="Add gate rules to block, flag, or require review for risky updates."
                  action={
                    <Button variant="secondary" onClick={openCreateRule}>
                      Add rule
                    </Button>
                  }
                />
              ) : (
                rules.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      r.enabled
                        ? 'border-neutral-800 bg-neutral-950/50'
                        : 'border-neutral-900 bg-neutral-950/20 opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-neutral-100">
                          {prettyKey(r.rule_type)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Badge tone={actionTone(r.action)}>{prettyKey(r.action)}</Badge>
                          {r.threshold != null && (
                            <span className="text-xs text-neutral-500">threshold {r.threshold}</span>
                          )}
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={() => toggleRuleEnabled(r)}
                          className="h-3.5 w-3.5 accent-lime-400"
                        />
                        <span className="text-xs text-neutral-500">On</span>
                      </label>
                    </div>
                    <div className="mt-2 flex items-center gap-3 border-t border-neutral-800 pt-2">
                      <button
                        onClick={() => openEditRule(r)}
                        className="text-xs text-neutral-400 hover:text-lime-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteRuleTarget(r)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200">Dry-run simulation</h2>
              <Button onClick={runSimulation} disabled={simRunning}>
                {simRunning ? <Spinner className="h-4 w-4" /> : 'Run'}
              </Button>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-neutral-500">
                Apply the current weights, bands and rules to historical updates without committing.
              </p>
              {simError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {simError}
                </div>
              )}
              {sim && (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Evaluated" value={simStats.total} />
                  <Stat label="Cleared" value={simStats.cleared} accent />
                  <Stat label="Flagged" value={simStats.flagged} />
                  <Stat label="Blocked" value={simStats.blocked} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {sim && simResults.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-200">Simulation results</h2>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Package</TH>
                  <TH>Change</TH>
                  <TH>Grade</TH>
                  <TH className="text-right">Score</TH>
                  <TH>Outcome</TH>
                  <TH>Message</TH>
                </TR>
              </THead>
              <TBody>
                {simResults.map((r, i) => (
                  <TR key={r.update_id ?? i}>
                    <TD className="font-medium text-neutral-100">
                      {r.package || r.package_name || '—'}
                    </TD>
                    <TD className="text-xs text-neutral-400">
                      {r.from_version || '?'} → {r.to_version || '?'}
                    </TD>
                    <TD>
                      <Badge tone={gradeTone(r.grade)}>{(r.grade || '—').toUpperCase()}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {r.score == null ? '—' : Math.round(r.score)}
                    </TD>
                    <TD>
                      {r.action ? (
                        <Badge tone={actionTone(r.action)}>{prettyKey(r.action)}</Badge>
                      ) : r.passed === false ? (
                        <Badge tone="red">Blocked</Badge>
                      ) : (
                        <Badge tone="green">Cleared</Badge>
                      )}
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-neutral-500" title={r.message || ''}>
                      {r.message || '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {sim && simResults.length === 0 && (
        <Card>
          <CardBody>
            <EmptyState
              title="No updates to simulate"
              description="There are no historical updates for this workspace yet. Import or create updates first."
            />
          </CardBody>
        </Card>
      )}

      {/* Rule modal */}
      <Modal
        open={ruleModalOpen}
        onClose={() => !savingRule && setRuleModalOpen(false)}
        title={editingRule ? 'Edit rule' : 'New gate rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleModalOpen(false)} disabled={savingRule}>
              Cancel
            </Button>
            <Button onClick={submitRule} disabled={savingRule}>
              {savingRule ? <Spinner className="h-4 w-4" /> : editingRule ? 'Save rule' : 'Add rule'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitRule} className="space-y-4">
          {ruleError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {ruleError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Rule type
            </label>
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500/60 focus:outline-none"
            >
              {RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {prettyKey(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Threshold
              </label>
              <input
                type="number"
                value={ruleThreshold}
                onChange={(e) => setRuleThreshold(e.target.value)}
                placeholder="optional"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Action
              </label>
              <select
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-lime-500/60 focus:outline-none"
              >
                {RULE_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {prettyKey(a)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={ruleEnabled}
              onChange={(e) => setRuleEnabled(e.target.checked)}
              className="h-4 w-4 accent-lime-400"
            />
            Enabled
          </label>
        </form>
      </Modal>

      <Modal
        open={deleteRuleTarget != null}
        onClose={() => setDeleteRuleTarget(null)}
        title="Delete rule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteRuleTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteRule}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete the{' '}
          <span className="font-semibold text-neutral-100">
            {deleteRuleTarget ? prettyKey(deleteRuleTarget.rule_type) : ''}
          </span>{' '}
          rule? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
