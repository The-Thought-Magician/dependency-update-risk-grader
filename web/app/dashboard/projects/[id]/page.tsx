'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

type Project = {
  id: string
  workspace_id: string
  name: string
  ecosystem: string
  repo_url: string | null
  tags?: string[] | null
  dependency_count: number
  created_at?: string
  updated_at?: string
}

type Dependency = {
  id: string
  project_id: string
  package_id: string
  current_version: string
  version_range?: string | null
  is_direct: boolean
  is_dev: boolean
  // optional joined fields the backend may include
  package_name?: string | null
  name?: string | null
  reputation_tier?: string | null
  weekly_downloads?: number | null
  is_deprecated?: boolean | null
  is_archived?: boolean | null
  typosquat_suspect?: boolean | null
  grade?: string | null
}

type Manifest = {
  id: string
  project_id: string
  ecosystem: string
  filename: string
  kind: string
  content?: string
  parsed?: Record<string, unknown> | null
  created_at?: string
}

type Summary = {
  counts?: Record<string, number>
  grades?: Record<string, number>
  [k: string]: unknown
}

const INPUT =
  'w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500/50 focus:outline-none'
const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']
const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'maven', 'go', 'rubygems', 'nuget']
const MANIFEST_HINTS: Record<string, string> = {
  npm: 'package.json',
  pypi: 'requirements.txt',
  cargo: 'Cargo.toml',
  maven: 'pom.xml',
  go: 'go.mod',
  rubygems: 'Gemfile',
  nuget: 'packages.config',
}

function depName(d: Dependency): string {
  return d.package_name || d.name || d.package_id
}

function gradeTone(g: string): 'green' | 'lime' | 'amber' | 'red' | 'neutral' {
  const u = g.toUpperCase()
  if (u === 'A') return 'green'
  if (u === 'B') return 'lime'
  if (u === 'C' || u === 'D') return 'amber'
  if (u === 'F') return 'red'
  return 'neutral'
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const projectId = params?.id

  const [project, setProject] = useState<Project | null>(null)
  const [deps, setDeps] = useState<Dependency[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [manifests, setManifests] = useState<Manifest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inventory filtering
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<'all' | 'direct' | 'dev'>('all')

  // Edit project modal
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editRepo, setEditRepo] = useState('')
  const [editEcosystem, setEditEcosystem] = useState('npm')
  const [editTags, setEditTags] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)

  // Upload manifest modal
  const [uploadOpen, setUploadOpen] = useState(false)
  const [mFilename, setMFilename] = useState('')
  const [mEcosystem, setMEcosystem] = useState('npm')
  const [mKind, setMKind] = useState<'manifest' | 'lockfile'>('manifest')
  const [mContent, setMContent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const [p, d, s, m] = await Promise.all([
        api.getProject(projectId),
        api.getProjectDependencies(projectId).catch(() => []),
        api.getProjectSummary(projectId).catch(() => null),
        api.listManifests(projectId).catch(() => []),
      ])
      setProject(p)
      setDeps(Array.isArray(d) ? d : [])
      setSummary(s)
      setManifests(Array.isArray(m) ? m : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = () => {
    if (!project) return
    setEditName(project.name)
    setEditRepo(project.repo_url ?? '')
    setEditEcosystem(project.ecosystem || 'npm')
    setEditTags((project.tags ?? []).join(', '))
    setEditErr(null)
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!project) return
    if (!editName.trim()) {
      setEditErr('Name is required')
      return
    }
    setSavingEdit(true)
    setEditErr(null)
    try {
      const updated = await api.updateProject(project.id, {
        name: editName.trim(),
        repo_url: editRepo.trim() || null,
        ecosystem: editEcosystem,
        tags: editTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      setProject(updated)
      setEditOpen(false)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingEdit(false)
    }
  }

  const openUpload = () => {
    setMEcosystem(project?.ecosystem || 'npm')
    setMFilename(MANIFEST_HINTS[project?.ecosystem || 'npm'] || '')
    setMKind('manifest')
    setMContent('')
    setUploadErr(null)
    setUploadOpen(true)
  }

  const submitUpload = async () => {
    if (!projectId) return
    if (!mFilename.trim() || !mContent.trim()) {
      setUploadErr('Filename and content are required')
      return
    }
    setUploading(true)
    setUploadErr(null)
    try {
      await api.uploadManifest({
        project_id: projectId,
        ecosystem: mEcosystem,
        filename: mFilename.trim(),
        kind: mKind,
        content: mContent,
      })
      setUploadOpen(false)
      await load()
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const filteredDeps = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deps.filter((d) => {
      if (scope === 'direct' && !d.is_direct) return false
      if (scope === 'dev' && !d.is_dev) return false
      if (q && !depName(d).toLowerCase().includes(q)) return false
      return true
    })
  }, [deps, search, scope])

  const gradeBuckets = useMemo(() => {
    const fromSummary = summary?.grades
    if (fromSummary && Object.keys(fromSummary).length) return fromSummary
    // Fall back to counting grades present on dependency rows.
    const acc: Record<string, number> = {}
    for (const d of deps) {
      if (d.grade) acc[d.grade.toUpperCase()] = (acc[d.grade.toUpperCase()] ?? 0) + 1
    }
    return acc
  }, [summary, deps])

  const directCount = deps.filter((d) => d.is_direct).length
  const devCount = deps.filter((d) => d.is_dev).length
  const riskyCount = deps.filter((d) => d.is_deprecated || d.is_archived || d.typosquat_suspect).length

  if (loading) return <PageSpinner label="Loading project..." />

  if (error || !project) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load project"
          description={error ?? 'This project may have been removed.'}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
              <Link href="/dashboard/projects">
                <Button variant="ghost">Back to projects</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/projects" className="text-xs text-neutral-500 hover:text-lime-300">
          ← Projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">{project.name}</h1>
              <Badge tone="lime">{project.ecosystem}</Badge>
            </div>
            {project.repo_url ? (
              <a
                href={project.repo_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block break-all text-sm text-neutral-400 hover:text-lime-300"
              >
                {project.repo_url}
              </a>
            ) : (
              <p className="mt-1 text-sm text-neutral-600">No repository linked</p>
            )}
            {(project.tags ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(project.tags ?? []).map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={openEdit}>
              Edit
            </Button>
            <Button onClick={openUpload}>Upload manifest</Button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Dependencies" value={deps.length || project.dependency_count} accent />
        <Stat label="Direct" value={directCount} hint={`${devCount} dev`} />
        <Stat label="Manifests" value={manifests.length} />
        <Stat label="At-risk packages" value={riskyCount} hint="deprecated / archived / typosquat" />
      </div>

      {/* Risk posture */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Risk posture</h2>
        </CardHeader>
        <CardBody>
          {Object.keys(gradeBuckets).length === 0 ? (
            <p className="text-sm text-neutral-500">
              No graded updates yet for this project. Risk grades appear once update bumps are evaluated.
            </p>
          ) : (
            <GradeBars buckets={gradeBuckets} />
          )}
          {summary?.counts && Object.keys(summary.counts).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(summary.counts).map(([k, v]) => (
                <Badge key={k} tone="neutral">
                  {k}: <span className="font-semibold text-neutral-200">{v}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Manifests */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Manifests</h2>
            <Button variant="ghost" onClick={openUpload}>
              + Upload
            </Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {manifests.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No manifests uploaded"
                description="Upload a package.json, requirements.txt, Cargo.toml, or other manifest to build the dependency inventory."
                action={<Button onClick={openUpload}>Upload manifest</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Filename</TH>
                  <TH>Ecosystem</TH>
                  <TH>Kind</TH>
                  <TH>Parsed entries</TH>
                  <TH>Uploaded</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {manifests.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium text-neutral-100">{m.filename}</TD>
                    <TD>
                      <Badge tone="lime">{m.ecosystem}</Badge>
                    </TD>
                    <TD>{m.kind}</TD>
                    <TD>{m.parsed ? Object.keys(m.parsed).length : 0}</TD>
                    <TD className="text-neutral-500">
                      {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <DeleteManifestButton id={m.id} onDeleted={load} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Dependency inventory */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-200">Dependency inventory</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter packages..."
                className="w-48 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500/50 focus:outline-none"
              />
              <div className="flex overflow-hidden rounded-lg border border-neutral-800">
                {(['all', 'direct', 'dev'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      scope === s
                        ? 'bg-lime-400/15 text-lime-300'
                        : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {deps.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState
                title="No dependencies yet"
                description="Upload a manifest to populate this project's dependency inventory."
                action={<Button onClick={openUpload}>Upload manifest</Button>}
              />
            </div>
          ) : filteredDeps.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState title="No matches" description="No dependencies match your current filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Package</TH>
                  <TH>Version</TH>
                  <TH>Range</TH>
                  <TH>Scope</TH>
                  <TH>Signals</TH>
                  <TH>Grade</TH>
                </TR>
              </THead>
              <TBody>
                {filteredDeps.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-medium text-neutral-100">
                      <Link href={`/dashboard/packages/${d.package_id}`} className="hover:text-lime-300">
                        {depName(d)}
                      </Link>
                      {d.reputation_tier && (
                        <span className="ml-2 text-xs text-neutral-600">{d.reputation_tier}</span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{d.current_version}</TD>
                    <TD className="font-mono text-xs text-neutral-500">{d.version_range || '—'}</TD>
                    <TD>
                      <div className="flex gap-1">
                        <Badge tone={d.is_direct ? 'lime' : 'neutral'}>{d.is_direct ? 'direct' : 'transitive'}</Badge>
                        {d.is_dev && <Badge tone="neutral">dev</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {d.is_deprecated && <Badge tone="red">deprecated</Badge>}
                        {d.is_archived && <Badge tone="amber">archived</Badge>}
                        {d.typosquat_suspect && <Badge tone="red">typosquat?</Badge>}
                        {!d.is_deprecated && !d.is_archived && !d.typosquat_suspect && (
                          <span className="text-xs text-neutral-600">—</span>
                        )}
                      </div>
                    </TD>
                    <TD>{d.grade ? <GradeBadge grade={d.grade} /> : <span className="text-neutral-600">—</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? <Spinner className="h-4 w-4" /> : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {editErr && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{editErr}</p>}
          <Field label="Name">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field label="Repository URL">
            <input
              value={editRepo}
              onChange={(e) => setEditRepo(e.target.value)}
              placeholder="https://github.com/org/repo"
              className={INPUT}
            />
          </Field>
          <Field label="Ecosystem">
            <select value={editEcosystem} onChange={(e) => setEditEcosystem(e.target.value)} className={INPUT}>
              {ECOSYSTEMS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags (comma separated)">
            <input
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="backend, critical"
              className={INPUT}
            />
          </Field>
        </div>
      </Modal>

      {/* Upload manifest modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload manifest"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={submitUpload} disabled={uploading}>
              {uploading ? <Spinner className="h-4 w-4" /> : 'Upload & parse'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {uploadErr && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{uploadErr}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ecosystem">
              <select
                value={mEcosystem}
                onChange={(e) => {
                  setMEcosystem(e.target.value)
                  if (!mFilename || Object.values(MANIFEST_HINTS).includes(mFilename)) {
                    setMFilename(MANIFEST_HINTS[e.target.value] || '')
                  }
                }}
                className={INPUT}
              >
                {ECOSYSTEMS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kind">
              <select value={mKind} onChange={(e) => setMKind(e.target.value as 'manifest' | 'lockfile')} className={INPUT}>
                <option value="manifest">manifest</option>
                <option value="lockfile">lockfile</option>
              </select>
            </Field>
          </div>
          <Field label="Filename">
            <input value={mFilename} onChange={(e) => setMFilename(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Content">
            <textarea
              value={mContent}
              onChange={(e) => setMContent(e.target.value)}
              rows={10}
              placeholder='{ "dependencies": { "express": "^4.18.2" } }'
              className={`${INPUT} font-mono text-xs`}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

function GradeBars({ buckets }: { buckets: Record<string, number> }) {
  const entries = GRADE_ORDER.map((g) => [g, buckets[g] ?? 0] as const).filter(([, n]) => n > 0)
  const extra = Object.entries(buckets).filter(([g]) => !GRADE_ORDER.includes(g.toUpperCase()))
  const all = [...entries, ...extra.map(([g, n]) => [g.toUpperCase(), n] as const)]
  const max = Math.max(1, ...all.map(([, n]) => n))
  return (
    <div className="flex flex-col gap-2">
      {all.map(([g, n]) => (
        <div key={g} className="flex items-center gap-3">
          <div className="w-8">
            <GradeBadge grade={g} />
          </div>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-800">
            <div
              className={`h-full rounded-full ${
                gradeTone(g) === 'green'
                  ? 'bg-emerald-500'
                  : gradeTone(g) === 'lime'
                  ? 'bg-lime-400'
                  : gradeTone(g) === 'amber'
                  ? 'bg-amber-400'
                  : gradeTone(g) === 'red'
                  ? 'bg-red-500'
                  : 'bg-neutral-600'
              }`}
              style={{ width: `${(n / max) * 100}%` }}
            />
          </div>
          <div className="w-8 text-right text-sm font-semibold text-neutral-300">{n}</div>
        </div>
      ))}
    </div>
  )
}

function DeleteManifestButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const del = async () => {
    setBusy(true)
    try {
      await api.deleteManifest(id)
      onDeleted()
    } catch {
      setBusy(false)
      setConfirm(false)
    }
  }
  if (confirm) {
    return (
      <span className="flex justify-end gap-1">
        <Button variant="danger" className="px-2 py-1 text-xs" onClick={del} disabled={busy}>
          {busy ? '...' : 'Confirm'}
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirm(false)} disabled={busy}>
          No
        </Button>
      </span>
    )
  }
  return (
    <Button variant="ghost" className="px-2 py-1 text-xs text-red-400 hover:text-red-300" onClick={() => setConfirm(true)}>
      Delete
    </Button>
  )
}
