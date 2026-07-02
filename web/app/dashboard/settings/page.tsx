'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  slug?: string
  owner_id?: string
  default_ecosystem?: string
  default_policy_id?: string | null
  auto_clear_max_grade?: string
  created_at?: string
}

interface Member {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at?: string
}

interface Plan {
  id: string
  name?: string
  price_cents?: number | null
  [k: string]: unknown
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id: string
  status: string
  current_period_end?: string | null
  [k: string]: unknown
}

interface BillingInfo {
  subscription: Subscription
  plan: Plan | null
  stripeEnabled: boolean
}

const WS_KEY = 'durg.workspace_id'

const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'maven', 'go', 'rubygems', 'nuget']
const GRADES = ['A', 'B', 'C', 'D', 'F']

const ROLE_TONE: Record<string, 'lime' | 'blue' | 'amber' | 'neutral'> = {
  owner: 'lime',
  admin: 'blue',
  reviewer: 'amber',
  viewer: 'neutral',
}

function fmtDate(s?: string | null): string {
  if (!s) return '–'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [billing, setBilling] = useState<BillingInfo | null>(null)

  const [newWsName, setNewWsName] = useState('')
  const [creatingWs, setCreatingWs] = useState(false)
  const [createWsError, setCreateWsError] = useState<string | null>(null)

  // Editable workspace fields
  const [name, setName] = useState('')
  const [ecosystem, setEcosystem] = useState('npm')
  const [autoClear, setAutoClear] = useState('B')
  const [saving, setSaving] = useState(false)

  const [billingBusy, setBillingBusy] = useState(false)

  async function loadWorkspace(wsId: string) {
    const [ws, mem, bill] = await Promise.allSettled([
      api.getWorkspace(wsId),
      api.listMembers(wsId),
      api.getBillingPlan(),
    ])
    if (ws.status === 'fulfilled' && ws.value) {
      const w = ws.value as Workspace
      setWorkspace(w)
      setName(w.name ?? '')
      setEcosystem(w.default_ecosystem ?? 'npm')
      setAutoClear(w.auto_clear_max_grade ?? 'B')
    }
    // listMembers requires membership; tolerate a 403 for non-members.
    if (mem.status === 'fulfilled' && Array.isArray(mem.value)) setMembers(mem.value)
    else setMembers([])
    if (bill.status === 'fulfilled' && bill.value) setBilling(bill.value as BillingInfo)
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
        if (!chosen) {
          setLoading(false)
          return
        }
        await loadWorkspace(chosen)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load settings')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function switchWorkspace(id: string) {
    localStorage.setItem(WS_KEY, id)
    setLoading(true)
    setError(null)
    setSavedMsg(null)
    try {
      await loadWorkspace(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  async function saveWorkspace() {
    if (!workspace) return
    if (!name.trim()) {
      setActionError('Workspace name is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    setSavedMsg(null)
    try {
      const updated: Workspace = await api.updateWorkspace(workspace.id, {
        name: name.trim(),
        default_ecosystem: ecosystem,
        auto_clear_max_grade: autoClear,
      })
      setWorkspace((prev) => (prev ? { ...prev, ...updated } : updated))
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)))
      setSavedMsg('Workspace settings saved.')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to save workspace')
    } finally {
      setSaving(false)
    }
  }

  async function createWorkspace() {
    if (!newWsName.trim()) {
      setCreateWsError('Workspace name is required.')
      return
    }
    setCreatingWs(true)
    setCreateWsError(null)
    try {
      const created: Workspace = await api.createWorkspace({ name: newWsName.trim() })
      localStorage.setItem(WS_KEY, created.id)
      setWorkspaces((prev) => [...prev, created])
      await loadWorkspace(created.id)
    } catch (e) {
      setCreateWsError(e instanceof Error ? e.message : 'Failed to create workspace')
    } finally {
      setCreatingWs(false)
    }
  }

  async function manageBilling() {
    setBillingBusy(true)
    setActionError(null)
    try {
      const isPro = billing?.subscription?.plan_id === 'pro'
      const res = isPro ? await api.openPortal() : await api.startCheckout()
      if (res?.url) window.location.href = res.url
      else setActionError('Billing portal is not available in this environment.')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Billing is not configured')
    } finally {
      setBillingBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load settings"
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

  if (!workspace) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Create your workspace</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              You need a workspace before you can track projects and grade updates.
            </p>
          </CardHeader>
          <CardBody className="space-y-4">
            {createWsError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {createWsError}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Workspace name
              </label>
              <input
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. Acme Engineering"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
              />
            </div>
            <Button onClick={() => void createWorkspace()} disabled={creatingWs}>
              {creatingWs ? <Spinner className="h-4 w-4" /> : 'Create workspace'}
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const planId = billing?.subscription?.plan_id ?? 'free'
  const planName = billing?.plan?.name ?? (planId === 'pro' ? 'Pro' : 'Free')
  const isPro = planId === 'pro'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Workspace configuration, team members, and billing.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspace.id}
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

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}
      {savedMsg && (
        <div className="rounded-lg border border-pink-500/30 bg-pink-400/10 px-4 py-3 text-sm text-pink-300">
          {savedMsg}
        </div>
      )}

      {/* Workspace */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Workspace</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Only the workspace owner can change these settings.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Default ecosystem
              </label>
              <select
                value={ecosystem}
                onChange={(e) => setEcosystem(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-pink-500 focus:outline-none"
              >
                {ECOSYSTEMS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Auto-clear updates at or below grade
              </label>
              <div className="flex gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setAutoClear(g)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      autoClear === g
                        ? 'border-pink-500/40 bg-pink-400/15 text-pink-300'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-600">
              Slug <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-400">{workspace.slug ?? '–'}</code>
              <span className="ml-3">Created {fmtDate(workspace.created_at)}</span>
            </div>
            <Button onClick={() => void saveWorkspace()} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Save changes'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Plan & billing</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Subscription tier for your account.</p>
          </div>
          <Badge tone={isPro ? 'lime' : 'neutral'}>{planName}</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Current plan" value={planName} accent={isPro} />
            <Stat label="Status" value={billing?.subscription?.status ?? 'active'} />
            <Stat
              label="Renews"
              value={fmtDate(billing?.subscription?.current_period_end)}
            />
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-500">
              {billing?.stripeEnabled
                ? isPro
                  ? 'Manage your subscription, payment method and invoices in the billing portal.'
                  : 'Upgrade to Pro for higher limits and team features.'
                : 'Billing is not configured in this environment.'}
            </p>
            <Button
              variant={isPro ? 'secondary' : 'primary'}
              onClick={() => void manageBilling()}
              disabled={billingBusy || !billing?.stripeEnabled}
            >
              {billingBusy ? <Spinner className="h-4 w-4" /> : isPro ? 'Manage billing' : 'Upgrade to Pro'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Members ({members.length})</h2>
          <p className="mt-0.5 text-xs text-zinc-500">People with access to this workspace.</p>
        </CardHeader>
        <CardBody className="p-0">
          {members.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-zinc-500">
              No members listed. You may not have permission to view the member list for this workspace.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Role</TH>
                  <TH className="text-right">Joined</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-mono text-xs text-zinc-300">{m.user_id}</TD>
                    <TD>
                      <Badge tone={ROLE_TONE[m.role] ?? 'neutral'}>{m.role}</Badge>
                    </TD>
                    <TD className="text-right text-xs text-zinc-500">{fmtDate(m.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
