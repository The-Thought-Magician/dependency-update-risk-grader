'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Alert {
  id: string
  workspace_id: string
  alert_rule_id: string | null
  update_id: string | null
  severity: string
  title: string
  message: string | null
  is_resolved: boolean
  created_at: string
}

interface AlertRule {
  id: string
  workspace_id: string
  name: string
  trigger_type: string
  threshold: string | null
  channel: string
  webhook_url: string | null
  enabled: boolean
  created_by?: string
  created_at?: string
}

const WS_KEY = 'durg.workspace_id'

const TRIGGER_TYPES = [
  { value: 'grade_below', label: 'Grade below threshold' },
  { value: 'score_above', label: 'Score above threshold' },
  { value: 'install_script_change', label: 'New install script' },
  { value: 'maintainer_change', label: 'Maintainer change' },
  { value: 'policy_violation', label: 'Policy violation' },
  { value: 'typosquat_suspect', label: 'Typosquat suspect' },
]

const CHANNELS = [
  { value: 'in_app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'slack', label: 'Slack' },
]

function severityTone(sev: string): 'red' | 'amber' | 'lime' | 'blue' | 'neutral' {
  const s = sev.toLowerCase()
  if (s === 'critical' || s === 'high') return 'red'
  if (s === 'medium' || s === 'warning') return 'amber'
  if (s === 'low') return 'blue'
  if (s === 'info') return 'lime'
  return 'neutral'
}

const emptyRuleForm = {
  name: '',
  trigger_type: 'grade_below',
  threshold: 'C',
  channel: 'in_app',
  webhook_url: '',
  enabled: true,
}

export default function AlertsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [rules, setRules] = useState<AlertRule[]>([])

  const [tab, setTab] = useState<'feed' | 'rules'>('feed')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [showResolved, setShowResolved] = useState(false)

  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null)
  const [ruleForm, setRuleForm] = useState(emptyRuleForm)
  const [savingRule, setSavingRule] = useState(false)
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null)

  async function loadWorkspaceData(wsId: string) {
    const [a, r] = await Promise.all([api.listAlerts(wsId), api.listAlertRules(wsId)])
    setAlerts(a || [])
    setRules(r || [])
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
        if (chosen) await loadWorkspaceData(chosen)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load alerts')
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
      await loadWorkspaceData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }

  const severities = useMemo(() => {
    const s = new Set<string>()
    alerts.forEach((a) => a.severity && s.add(a.severity))
    return Array.from(s)
  }, [alerts])

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (!showResolved && a.is_resolved) return false
      if (severityFilter !== 'all' && a.severity !== severityFilter) return false
      return true
    })
  }, [alerts, showResolved, severityFilter])

  const stats = useMemo(() => {
    const open = alerts.filter((a) => !a.is_resolved)
    const critical = open.filter((a) => ['critical', 'high'].includes(a.severity.toLowerCase()))
    return {
      open: open.length,
      critical: critical.length,
      resolved: alerts.length - open.length,
      activeRules: rules.filter((r) => r.enabled).length,
    }
  }, [alerts, rules])

  async function resolve(id: string) {
    setResolvingId(id)
    setActionError(null)
    try {
      const updated: Alert = await api.resolveAlert(id)
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, ...updated, is_resolved: true } : a)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to resolve alert')
    } finally {
      setResolvingId(null)
    }
  }

  function openCreateRule() {
    setEditingRule(null)
    setRuleForm(emptyRuleForm)
    setRuleModalOpen(true)
  }

  function openEditRule(rule: AlertRule) {
    setEditingRule(rule)
    setRuleForm({
      name: rule.name,
      trigger_type: rule.trigger_type,
      threshold: rule.threshold ?? '',
      channel: rule.channel,
      webhook_url: rule.webhook_url ?? '',
      enabled: rule.enabled,
    })
    setRuleModalOpen(true)
  }

  async function saveRule() {
    if (!ruleForm.name.trim()) {
      setActionError('Rule name is required.')
      return
    }
    setSavingRule(true)
    setActionError(null)
    const body = {
      workspace_id: workspaceId,
      name: ruleForm.name.trim(),
      trigger_type: ruleForm.trigger_type,
      threshold: ruleForm.threshold.trim() || null,
      channel: ruleForm.channel,
      webhook_url: ruleForm.channel === 'webhook' || ruleForm.channel === 'slack' ? ruleForm.webhook_url.trim() || null : null,
      enabled: ruleForm.enabled,
    }
    try {
      if (editingRule) {
        const updated: AlertRule = await api.updateAlertRule(editingRule.id, body)
        setRules((prev) => prev.map((r) => (r.id === editingRule.id ? { ...r, ...updated } : r)))
      } else {
        const created: AlertRule = await api.createAlertRule(body)
        setRules((prev) => [created, ...prev])
      }
      setRuleModalOpen(false)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSavingRule(false)
    }
  }

  async function toggleRule(rule: AlertRule) {
    setActionError(null)
    try {
      const updated: AlertRule = await api.updateAlertRule(rule.id, { enabled: !rule.enabled })
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...updated, enabled: !rule.enabled } : r)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to toggle rule')
    }
  }

  async function deleteRule(id: string) {
    setDeletingRuleId(id)
    setActionError(null)
    try {
      await api.deleteAlertRule(id)
      setRules((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete rule')
    } finally {
      setDeletingRuleId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading alerts..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load alerts"
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
        description="Create a workspace first to start receiving alerts."
        icon="📭"
      />
    )
  }

  const needsWebhook = ruleForm.channel === 'webhook' || ruleForm.channel === 'slack'

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Alerts</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Real-time supply-chain alerts and the rules that trigger them.
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Open alerts" value={stats.open} accent={stats.open > 0} />
        <Stat label="Critical / high" value={stats.critical} hint="Need attention" />
        <Stat label="Resolved" value={stats.resolved} />
        <Stat label="Active rules" value={stats.activeRules} />
      </div>

      <div className="flex items-center gap-1 border-b border-neutral-800">
        <button
          onClick={() => setTab('feed')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'feed'
              ? 'border-lime-400 text-lime-300'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Alert feed
        </button>
        <button
          onClick={() => setTab('rules')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'rules'
              ? 'border-lime-400 text-lime-300'
              : 'border-transparent text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Alert rules ({rules.length})
        </button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {tab === 'feed' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="all">All severities</option>
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-neutral-400">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 accent-lime-400"
              />
              Show resolved
            </label>
          </div>

          {filteredAlerts.length === 0 ? (
            <EmptyState
              title={alerts.length === 0 ? 'No alerts yet' : 'No matching alerts'}
              description={
                alerts.length === 0
                  ? 'Alerts fire automatically when an update breaches one of your alert rules.'
                  : 'Adjust the severity filter or toggle resolved alerts.'
              }
              icon="🔔"
            />
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((a) => (
                <Card
                  key={a.id}
                  className={`flex items-start gap-4 px-5 py-4 ${a.is_resolved ? 'opacity-60' : ''}`}
                >
                  <div
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      a.is_resolved
                        ? 'bg-neutral-600'
                        : ['critical', 'high'].includes(a.severity.toLowerCase())
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-100">{a.title}</span>
                      <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                      {a.is_resolved && <Badge tone="green">resolved</Badge>}
                    </div>
                    {a.message && <p className="mt-1 text-sm text-neutral-400">{a.message}</p>}
                    <div className="mt-1 flex items-center gap-3 text-xs text-neutral-600">
                      <span>{new Date(a.created_at).toLocaleString()}</span>
                      {a.update_id && (
                        <a href={`/dashboard/updates/${a.update_id}`} className="text-lime-400 hover:underline">
                          View update
                        </a>
                      )}
                    </div>
                  </div>
                  {!a.is_resolved && (
                    <Button
                      variant="secondary"
                      disabled={resolvingId === a.id}
                      onClick={() => void resolve(a.id)}
                    >
                      {resolvingId === a.id ? <Spinner className="h-4 w-4" /> : 'Resolve'}
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateRule}>+ New rule</Button>
          </div>
          {rules.length === 0 ? (
            <EmptyState
              title="No alert rules"
              description="Create a rule to be notified when an update crosses a risk threshold."
              icon="⚙"
              action={<Button onClick={openCreateRule}>Create your first rule</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Trigger</TH>
                  <TH>Threshold</TH>
                  <TH>Channel</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rules.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-neutral-100">{r.name}</TD>
                    <TD>
                      {TRIGGER_TYPES.find((t) => t.value === r.trigger_type)?.label ??
                        r.trigger_type.replace(/_/g, ' ')}
                    </TD>
                    <TD>
                      {r.threshold ? (
                        <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs">{r.threshold}</code>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone="neutral">{CHANNELS.find((c) => c.value === r.channel)?.label ?? r.channel}</Badge>
                    </TD>
                    <TD>
                      <button
                        onClick={() => void toggleRule(r)}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                          r.enabled
                            ? 'border-lime-500/30 bg-lime-400/15 text-lime-300'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${r.enabled ? 'bg-lime-400' : 'bg-neutral-500'}`} />
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openEditRule(r)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                          disabled={deletingRuleId === r.id}
                          onClick={() => void deleteRule(r.id)}
                        >
                          {deletingRuleId === r.id ? <Spinner className="h-4 w-4" /> : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      )}

      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        title={editingRule ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRuleModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={savingRule} onClick={() => void saveRule()}>
              {savingRule ? <Spinner className="h-4 w-4" /> : editingRule ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Name</label>
            <input
              value={ruleForm.name}
              onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Block anything graded below C"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Trigger
              </label>
              <select
                value={ruleForm.trigger_type}
                onChange={(e) => setRuleForm((f) => ({ ...f, trigger_type: e.target.value }))}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500 focus:outline-none"
              >
                {TRIGGER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Threshold
              </label>
              <input
                value={ruleForm.threshold}
                onChange={(e) => setRuleForm((f) => ({ ...f, threshold: e.target.value }))}
                placeholder="e.g. C or 60"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Channel</label>
            <select
              value={ruleForm.channel}
              onChange={(e) => setRuleForm((f) => ({ ...f, channel: e.target.value }))}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500 focus:outline-none"
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {needsWebhook && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
                Webhook URL
              </label>
              <input
                value={ruleForm.webhook_url}
                onChange={(e) => setRuleForm((f) => ({ ...f, webhook_url: e.target.value }))}
                placeholder="https://hooks.example.com/..."
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={ruleForm.enabled}
              onChange={(e) => setRuleForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-900 accent-lime-400"
            />
            Enabled
          </label>
        </div>
      </Modal>
    </div>
  )
}
