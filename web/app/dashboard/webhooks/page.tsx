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

interface Webhook {
  id: string
  workspace_id: string
  name: string
  url: string
  event_types: string[]
  secret?: string | null
  enabled: boolean
  created_by?: string | null
  created_at?: string | null
}

interface Delivery {
  id: string
  webhook_id: string
  event_type: string
  payload?: Record<string, unknown> | null
  status: string
  status_code?: number | null
  attempt: number
  created_at?: string | null
}

const WS_KEY = 'durg.workspace_id'

// Mirrors the EVENT_TYPES enum in the backend webhooks route.
const EVENT_TYPES = [
  'update.created',
  'update.graded',
  'update.decision',
  'update.auto_cleared',
  'alert.raised',
  'policy.violation',
]

function fmtDate(s?: string | null): string {
  if (!s) return '–'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function deliveryTone(status: string): 'green' | 'red' | 'amber' | 'neutral' {
  const s = status.toLowerCase()
  if (s === 'delivered') return 'green'
  if (s === 'failed') return 'red'
  if (s === 'pending') return 'amber'
  return 'neutral'
}

const emptyForm = {
  name: '',
  url: '',
  secret: '',
  event_types: [] as string[],
  enabled: true,
}

export default function WebhooksPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')

  const [webhooks, setWebhooks] = useState<Webhook[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [testingId, setTestingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Deliveries drawer
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)

  async function loadWebhooks(wsId: string) {
    const rows = await api.listWebhooks(wsId)
    setWebhooks(Array.isArray(rows) ? rows : [])
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
        if (chosen) await loadWebhooks(chosen)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load webhooks')
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
      await loadWebhooks(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setActionError(null)
    setModalOpen(true)
  }

  function openEdit(wh: Webhook) {
    setEditing(wh)
    setForm({
      name: wh.name,
      url: wh.url,
      secret: wh.secret ?? '',
      event_types: wh.event_types ?? [],
      enabled: wh.enabled,
    })
    setActionError(null)
    setModalOpen(true)
  }

  function toggleEvent(ev: string) {
    setForm((f) => ({
      ...f,
      event_types: f.event_types.includes(ev)
        ? f.event_types.filter((e) => e !== ev)
        : [...f.event_types, ev],
    }))
  }

  async function save() {
    if (!form.name.trim()) {
      setActionError('Name is required.')
      return
    }
    if (!form.url.trim()) {
      setActionError('Endpoint URL is required.')
      return
    }
    setSaving(true)
    setActionError(null)
    try {
      if (editing) {
        const body = {
          name: form.name.trim(),
          url: form.url.trim(),
          secret: form.secret.trim() || undefined,
          event_types: form.event_types,
          enabled: form.enabled,
        }
        const updated: Webhook = await api.updateWebhook(editing.id, body)
        setWebhooks((prev) => prev.map((w) => (w.id === editing.id ? { ...w, ...updated } : w)))
      } else {
        const body = {
          workspace_id: workspaceId,
          name: form.name.trim(),
          url: form.url.trim(),
          secret: form.secret.trim() || undefined,
          event_types: form.event_types,
          enabled: form.enabled,
        }
        const created: Webhook = await api.createWebhook(body)
        setWebhooks((prev) => [created, ...prev])
      }
      setModalOpen(false)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to save webhook')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(wh: Webhook) {
    setActionError(null)
    try {
      const updated: Webhook = await api.updateWebhook(wh.id, { enabled: !wh.enabled })
      setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? { ...w, ...updated, enabled: !wh.enabled } : w)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to toggle webhook')
    }
  }

  async function sendTest(wh: Webhook) {
    setTestingId(wh.id)
    setActionError(null)
    try {
      await api.testWebhook(wh.id)
      // If the deliveries drawer is open for this webhook, refresh it.
      if (deliveriesFor?.id === wh.id) await openDeliveries(wh)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Test delivery failed')
    } finally {
      setTestingId(null)
    }
  }

  async function remove(id: string) {
    setDeletingId(id)
    setActionError(null)
    try {
      await api.deleteWebhook(id)
      setWebhooks((prev) => prev.filter((w) => w.id !== id))
      if (deliveriesFor?.id === id) setDeliveriesFor(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete webhook')
    } finally {
      setDeletingId(null)
    }
  }

  async function openDeliveries(wh: Webhook) {
    setDeliveriesFor(wh)
    setDeliveriesLoading(true)
    try {
      const rows = await api.getWebhookDeliveries(wh.id)
      setDeliveries(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to load deliveries')
      setDeliveries([])
    } finally {
      setDeliveriesLoading(false)
    }
  }

  const stats = useMemo(() => {
    const active = webhooks.filter((w) => w.enabled).length
    return { total: webhooks.length, active, disabled: webhooks.length - active }
  }, [webhooks])

  if (loading) return <PageSpinner label="Loading webhooks..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load webhooks"
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
        description="Create a workspace first to register outbound webhooks."
        icon="📭"
      />
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Webhooks</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Forward grading and decision events to your own systems and inspect delivery logs.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <Button onClick={openCreate}>+ New webhook</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Endpoints" value={stats.total} accent />
        <Stat label="Active" value={stats.active} />
        <Stat label="Disabled" value={stats.disabled} />
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      {webhooks.length === 0 ? (
        <EmptyState
          title="No webhooks yet"
          description="Register an endpoint to receive update.graded, update.decision and alert.raised events."
          icon="🔗"
          action={<Button onClick={openCreate}>Create your first webhook</Button>}
        />
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <Card key={wh.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-zinc-100">{wh.name}</span>
                  <button
                    onClick={() => void toggleEnabled(wh)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                      wh.enabled
                        ? 'border-pink-500/30 bg-pink-400/15 text-pink-300'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${wh.enabled ? 'bg-pink-400' : 'bg-zinc-500'}`} />
                    {wh.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <code className="mt-1 block truncate text-xs text-zinc-500">{wh.url}</code>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(wh.event_types ?? []).length === 0 ? (
                    <span className="text-xs text-zinc-600">all events</span>
                  ) : (
                    wh.event_types.map((ev) => (
                      <Badge key={ev} tone="neutral">
                        {ev}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={testingId === wh.id} onClick={() => void sendTest(wh)}>
                  {testingId === wh.id ? <Spinner className="h-4 w-4" /> : 'Send test'}
                </Button>
                <Button variant="ghost" onClick={() => void openDeliveries(wh)}>
                  Deliveries
                </Button>
                <Button variant="ghost" onClick={() => openEdit(wh)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-400 hover:text-red-300"
                  disabled={deletingId === wh.id}
                  onClick={() => void remove(wh.id)}
                >
                  {deletingId === wh.id ? <Spinner className="h-4 w-4" /> : 'Delete'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? 'Edit webhook' : 'New webhook'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : editing ? 'Save changes' : 'Create webhook'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Slack security channel"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Endpoint URL
            </label>
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://hooks.example.com/durg"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Signing secret <span className="font-normal normal-case text-zinc-600">(optional)</span>
            </label>
            <input
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              placeholder="Sent as X-Webhook-Secret"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-pink-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Events <span className="font-normal normal-case text-zinc-600">(none = all)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map((ev) => {
                const on = form.event_types.includes(ev)
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => toggleEvent(ev)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? 'border-pink-500/40 bg-pink-400/15 text-pink-300'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    {ev}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-pink-400"
            />
            Enabled
          </label>
        </div>
      </Modal>

      {/* Deliveries modal */}
      <Modal
        open={deliveriesFor != null}
        onClose={() => setDeliveriesFor(null)}
        title={deliveriesFor ? `Deliveries — ${deliveriesFor.name}` : 'Deliveries'}
        className="max-w-2xl"
        footer={
          <>
            {deliveriesFor && (
              <Button variant="secondary" disabled={testingId === deliveriesFor.id} onClick={() => void sendTest(deliveriesFor)}>
                {testingId === deliveriesFor.id ? <Spinner className="h-4 w-4" /> : 'Send test'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDeliveriesFor(null)}>
              Close
            </Button>
          </>
        }
      >
        {deliveriesLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : deliveries.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500">
            No deliveries recorded yet. Send a test delivery to verify the endpoint.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Event</TH>
                <TH>Status</TH>
                <TH className="text-right">Code</TH>
                <TH className="text-right">When</TH>
              </TR>
            </THead>
            <TBody>
              {deliveries.map((d) => (
                <TR key={d.id}>
                  <TD className="text-xs text-zinc-300">{d.event_type}</TD>
                  <TD>
                    <Badge tone={deliveryTone(d.status)}>{d.status}</Badge>
                  </TD>
                  <TD className="text-right text-xs tabular-nums text-zinc-400">{d.status_code ?? '–'}</TD>
                  <TD className="text-right text-xs text-zinc-500">{fmtDate(d.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Modal>
    </div>
  )
}
