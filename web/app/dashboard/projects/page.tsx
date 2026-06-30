'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  slug?: string
}

interface Project {
  id: string
  workspace_id: string
  name: string
  ecosystem: string
  repo_url?: string | null
  tags?: string[] | null
  dependency_count?: number
  created_at?: string
  updated_at?: string
}

const WS_KEY = 'durg.activeWorkspace'

function fmtDate(s?: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const ECO_TONE: Record<string, 'lime' | 'blue' | 'amber' | 'neutral' | 'red' | 'green'> = {
  npm: 'red',
  pypi: 'blue',
  cargo: 'amber',
  maven: 'green',
  go: 'lime',
}

export default function ProjectsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWs, setActiveWs] = useState<string>('')
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [ecoFilter, setEcoFilter] = useState<string>('all')

  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Resolve workspaces, then pick the active one (persisted) and load projects.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws: Workspace[] = (await api.listWorkspaces()) ?? []
        if (!mounted) return
        setWorkspaces(ws)
        if (ws.length === 0) {
          setProjects([])
          setLoading(false)
          return
        }
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        const chosen = (stored && ws.find((w) => w.id === stored)?.id) || ws[0].id
        setActiveWs(chosen)
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to load workspaces')
          setLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const loadProjects = useCallback(async (wsId: string) => {
    if (!wsId) return
    setLoading(true)
    setError(null)
    try {
      const data: Project[] = (await api.listProjects(wsId)) ?? []
      setProjects(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWs) return
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, activeWs)
    loadProjects(activeWs)
  }, [activeWs, loadProjects])

  const ecosystems = useMemo(() => {
    const set = new Set<string>()
    for (const p of projects) if (p.ecosystem) set.add(p.ecosystem)
    return Array.from(set).sort()
  }, [projects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter((p) => {
      if (ecoFilter !== 'all' && p.ecosystem !== ecoFilter) return false
      if (!q) return true
      const hay = `${p.name} ${p.repo_url ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [projects, search, ecoFilter])

  const totalDeps = useMemo(() => projects.reduce((acc, p) => acc + (p.dependency_count ?? 0), 0), [projects])

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setActionError(null)
    try {
      await api.deleteProject(pendingDelete.id)
      setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Projects</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Repositories under supply-chain watch. Each project holds a dependency inventory graded for update risk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={activeWs}
              onChange={(e) => setActiveWs(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Link href="/dashboard/projects/new">
            <Button>+ New Project</Button>
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Projects" value={projects.length} accent />
        <Stat label="Dependencies" value={totalDeps} />
        <Stat label="Ecosystems" value={ecosystems.length} />
        <Stat label="Showing" value={filtered.length} hint={filtered.length === projects.length ? 'all' : 'filtered'} />
      </div>

      {/* Filters */}
      <Card className="mt-6">
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, repo, or tag..."
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-lime-500/50 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-neutral-600">Ecosystem</span>
            <select
              value={ecoFilter}
              onChange={(e) => setEcoFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              <option value="all">All</option>
              {ecosystems.map((eco) => (
                <option key={eco} value={eco}>
                  {eco}
                </option>
              ))}
            </select>
          </div>
        </CardBody>
      </Card>

      {/* Body */}
      <div className="mt-6">
        {loading ? (
          <PageSpinner label="Loading projects..." />
        ) : error ? (
          <Card>
            <CardBody>
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-red-300">{error}</p>
                <Button variant="secondary" onClick={() => loadProjects(activeWs)}>
                  Retry
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : workspaces.length === 0 ? (
          <EmptyState
            title="No workspace yet"
            description="Create a workspace from Settings before adding projects."
            action={
              <Link href="/dashboard/settings">
                <Button variant="secondary">Go to Settings</Button>
              </Link>
            }
          />
        ) : projects.length === 0 ? (
          <EmptyState
            icon="📦"
            title="No projects yet"
            description="Add your first repository and upload a manifest to start grading dependency updates."
            action={
              <Link href="/dashboard/projects/new">
                <Button>+ New Project</Button>
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No matching projects"
            description="Adjust your search or ecosystem filter."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setEcoFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Ecosystem</TH>
                <TH className="text-right">Dependencies</TH>
                <TH>Tags</TH>
                <TH>Created</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="font-medium text-neutral-100 hover:text-lime-300"
                    >
                      {p.name}
                    </Link>
                    {p.repo_url && (
                      <div className="mt-0.5 max-w-xs truncate text-xs text-neutral-600">{p.repo_url}</div>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={ECO_TONE[p.ecosystem] ?? 'neutral'}>{p.ecosystem}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums text-neutral-200">{p.dependency_count ?? 0}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {(p.tags ?? []).length === 0 ? (
                        <span className="text-xs text-neutral-600">-</span>
                      ) : (
                        (p.tags ?? []).map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD className="text-neutral-400">{fmtDate(p.created_at)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link href={`/dashboard/projects/${p.id}`}>
                        <Button variant="ghost">View</Button>
                      </Link>
                      <Button variant="ghost" onClick={() => setPendingDelete(p)}>
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <Modal
        open={pendingDelete != null}
        onClose={() => {
          if (!deleting) {
            setPendingDelete(null)
            setActionError(null)
          }
        }}
        title="Delete project"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete <span className="font-semibold text-neutral-100">{pendingDelete?.name}</span> and its dependency
          inventory? This cannot be undone.
        </p>
        {actionError && <p className="mt-3 text-sm text-red-300">{actionError}</p>}
      </Modal>
    </div>
  )
}
