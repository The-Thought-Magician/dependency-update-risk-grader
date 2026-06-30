'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

interface Policy {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  weights?: Record<string, number> | null
  grade_bands?: Record<string, number> | null
  auto_clear_max_grade?: string | null
  is_default?: boolean | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface Workspace {
  id: string
  name: string
  slug?: string
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function gradeTone(g?: string | null): 'green' | 'lime' | 'amber' | 'red' | 'neutral' {
  const u = (g ?? '').toUpperCase()
  if (u === 'A') return 'green'
  if (u === 'B') return 'lime'
  if (u === 'C' || u === 'D') return 'amber'
  if (u === 'F') return 'red'
  return 'neutral'
}

export default function PoliciesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [autoClear, setAutoClear] = useState('B')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function loadPolicies(wsId: string) {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listPolicies(wsId)
      setPolicies(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load policies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!mounted) return
        const first = Array.isArray(ws) && ws.length ? ws[0] : null
        if (!first) {
          setError('No workspace found. Create a workspace first.')
          setLoading(false)
          return
        }
        setWorkspaceId(first.id)
        await loadPolicies(first.id)
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return policies
    return policies.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    )
  }, [policies, query])

  function openCreate() {
    setName('')
    setDescription('')
    setAutoClear('B')
    setFormError(null)
    setCreateOpen(true)
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    if (!name.trim()) {
      setFormError('Name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const created: Policy = await api.createPolicy({
        workspace_id: workspaceId,
        name: name.trim(),
        description: description.trim() || undefined,
        auto_clear_max_grade: autoClear,
      })
      setPolicies((prev) => [created, ...prev])
      setCreateOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create policy')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deletePolicy(deleteTarget.id)
      setPolicies((prev) => prev.filter((p) => p.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to delete policy')
    } finally {
      setDeleting(false)
    }
  }

  const stats = useMemo(() => {
    const total = policies.length
    const def = policies.find((p) => p.is_default)
    const withRules = policies.filter((p) => p.weights && Object.keys(p.weights).length).length
    return { total, defaultName: def?.name ?? '—', withRules }
  }, [policies])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-neutral-100">Policy Profiles</h1>
          <p className="text-sm text-neutral-500">
            Reusable scoring weights, grade bands and gate rules applied to dependency updates.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!workspaceId}>
          + New policy
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Policies" value={stats.total} />
        <Stat label="Default policy" value={stats.defaultName} accent />
        <Stat label="With custom weights" value={stats.withRules} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter policies..."
            className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500/60 focus:outline-none"
          />
          {workspaceId && (
            <Button variant="ghost" onClick={() => loadPolicies(workspaceId)}>
              Refresh
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {loading ? (
            <PageSpinner label="Loading policies..." />
          ) : error ? (
            <EmptyState
              title="Could not load policies"
              description={error}
              action={
                workspaceId ? (
                  <Button variant="secondary" onClick={() => loadPolicies(workspaceId)}>
                    Retry
                  </Button>
                ) : undefined
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={query ? 'No matching policies' : 'No policies yet'}
              description={
                query
                  ? 'Try a different filter.'
                  : 'Create a policy to define how risky updates are graded and gated.'
              }
              action={
                !query ? (
                  <Button onClick={openCreate} disabled={!workspaceId}>
                    Create policy
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => {
                const weightKeys = p.weights ? Object.keys(p.weights) : []
                return (
                  <div
                    key={p.id}
                    className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 transition-colors hover:border-neutral-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/policies/${p.id}`}
                            className="truncate font-semibold text-neutral-100 hover:text-lime-300"
                          >
                            {p.name}
                          </Link>
                          {p.is_default && <Badge tone="lime">Default</Badge>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
                          {p.description || 'No description.'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-neutral-500">Auto-clear ≤</span>
                      <Badge tone={gradeTone(p.auto_clear_max_grade)}>
                        {(p.auto_clear_max_grade || '—').toUpperCase()}
                      </Badge>
                      {weightKeys.length > 0 && (
                        <span className="text-neutral-500">· {weightKeys.length} weighted factors</span>
                      )}
                    </div>

                    <div className="mt-3 text-xs text-neutral-600">Updated {fmtDate(p.updated_at)}</div>

                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-neutral-800 pt-3">
                      <Link href={`/dashboard/policies/${p.id}`}>
                        <Button variant="secondary">Edit & rules</Button>
                      </Link>
                      <Button
                        variant="ghost"
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => setDeleteTarget(p)}
                        disabled={!!p.is_default}
                        title={p.is_default ? 'Cannot delete the default policy' : 'Delete policy'}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New policy profile"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? <Spinner className="h-4 w-4" /> : 'Create policy'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Production guardrails"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What this policy enforces..."
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-lime-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
              Auto-clear updates at or below grade
            </label>
            <div className="flex gap-2">
              {['A', 'B', 'C', 'D', 'F'].map((g) => (
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
            <p className="mt-1 text-xs text-neutral-600">
              Lower-risk grades cleared automatically; riskier updates require review.
            </p>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget != null}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete policy"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner className="h-4 w-4" /> : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete <span className="font-semibold text-neutral-100">{deleteTarget?.name}</span>? This
          removes its rules and cannot be undone. Updates currently graded by this policy keep their
          historical scores.
        </p>
      </Modal>
    </div>
  )
}
