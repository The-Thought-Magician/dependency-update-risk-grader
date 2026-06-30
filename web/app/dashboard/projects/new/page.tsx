'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner } from '@/components/ui/Spinner'

interface Workspace {
  id: string
  name: string
  slug?: string
  default_ecosystem?: string
}

interface Project {
  id: string
  name: string
  ecosystem: string
}

const WS_KEY = 'durg.activeWorkspace'

const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'maven', 'go'] as const

// Default manifest filename per ecosystem, used to prefill the upload step.
const DEFAULT_MANIFEST: Record<string, string> = {
  npm: 'package.json',
  pypi: 'requirements.txt',
  cargo: 'Cargo.toml',
  maven: 'pom.xml',
  go: 'go.mod',
}

const SAMPLE_NPM = `{
  "name": "my-app",
  "dependencies": {
    "express": "^4.19.2",
    "lodash": "^4.17.21"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}`

export default function NewProjectPage() {
  const router = useRouter()

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWs, setActiveWs] = useState<string>('')
  const [loadingWs, setLoadingWs] = useState(true)
  const [wsError, setWsError] = useState<string | null>(null)

  // Step 1 — project fields
  const [name, setName] = useState('')
  const [ecosystem, setEcosystem] = useState<string>('npm')
  const [repoUrl, setRepoUrl] = useState('')
  const [tagsInput, setTagsInput] = useState('')

  // Step 2 — manifest
  const [uploadManifestToggle, setUploadManifestToggle] = useState(true)
  const [manifestFilename, setManifestFilename] = useState<string>('package.json')
  const [manifestContent, setManifestContent] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [createdProject, setCreatedProject] = useState<Project | null>(null)
  const [manifestStatus, setManifestStatus] = useState<'idle' | 'ok' | 'skipped' | 'failed'>('idle')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoadingWs(true)
      setWsError(null)
      try {
        const ws: Workspace[] = (await api.listWorkspaces()) ?? []
        if (!mounted) return
        setWorkspaces(ws)
        if (ws.length > 0) {
          const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
          const chosen = (stored && ws.find((w) => w.id === stored)?.id) || ws[0].id
          setActiveWs(chosen)
          const eco = ws.find((w) => w.id === chosen)?.default_ecosystem
          if (eco) {
            setEcosystem(eco)
            setManifestFilename(DEFAULT_MANIFEST[eco] ?? 'package.json')
          }
        }
      } catch (e) {
        if (mounted) setWsError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoadingWs(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // Keep manifest filename in sync with ecosystem unless the user typed their own.
  useEffect(() => {
    setManifestFilename((prev) => {
      const known = Object.values(DEFAULT_MANIFEST)
      if (prev === '' || known.includes(prev)) return DEFAULT_MANIFEST[ecosystem] ?? prev
      return prev
    })
  }, [ecosystem])

  const tags = useMemo(
    () =>
      tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsInput]
  )

  const canSubmit = name.trim().length > 0 && activeWs && !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    setManifestStatus('idle')

    let project: Project
    try {
      project = await api.createProject({
        workspace_id: activeWs,
        name: name.trim(),
        ecosystem,
        repo_url: repoUrl.trim() || null,
        tags,
      })
      setCreatedProject(project)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create project')
      setSubmitting(false)
      return
    }

    // Optional manifest upload step.
    if (uploadManifestToggle && manifestContent.trim()) {
      try {
        await api.uploadManifest({
          project_id: project.id,
          ecosystem,
          filename: manifestFilename.trim() || DEFAULT_MANIFEST[ecosystem] || 'manifest',
          kind: 'manifest',
          content: manifestContent,
        })
        setManifestStatus('ok')
      } catch (err) {
        setManifestStatus('failed')
        setSubmitError(
          `Project created, but manifest upload failed: ${err instanceof Error ? err.message : 'unknown error'}`
        )
        setSubmitting(false)
        return
      }
    } else {
      setManifestStatus('skipped')
    }

    // Success — go to the project detail page.
    router.push(`/dashboard/projects/${project.id}`)
  }

  if (loadingWs) {
    return <PageSpinner label="Loading workspaces..." />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/projects" className="hover:text-lime-300">
          Projects
        </Link>
        <span>/</span>
        <span className="text-neutral-300">New</span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-neutral-100">New Project</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Register a repository and optionally upload its manifest. Packages and dependencies are parsed on upload so risk
        grading can begin.
      </p>

      {workspaces.length === 0 ? (
        <Card className="mt-6">
          <CardBody>
            <p className="text-sm text-neutral-300">
              You need a workspace before creating a project.{' '}
              <Link href="/dashboard/settings" className="text-lime-300 hover:underline">
                Create one in Settings.
              </Link>
            </p>
          </CardBody>
        </Card>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
          {wsError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {wsError}
            </div>
          )}

          {/* Project details */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-100">Project details</h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              {workspaces.length > 1 && (
                <Field label="Workspace">
                  <select
                    value={activeWs}
                    onChange={(e) => {
                      setActiveWs(e.target.value)
                      const eco = workspaces.find((w) => w.id === e.target.value)?.default_ecosystem
                      if (eco) setEcosystem(eco)
                    }}
                    className="input"
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Name" required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="payments-service"
                  className="input"
                  autoFocus
                  required
                />
              </Field>

              <Field label="Ecosystem">
                <div className="flex flex-wrap gap-2">
                  {ECOSYSTEMS.map((eco) => (
                    <button
                      key={eco}
                      type="button"
                      onClick={() => setEcosystem(eco)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        ecosystem === eco
                          ? 'border-lime-500/50 bg-lime-400/10 text-lime-300'
                          : 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-600'
                      }`}
                    >
                      {eco}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Repository URL">
                <input
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo"
                  className="input"
                  type="url"
                />
              </Field>

              <Field label="Tags" hint="Comma-separated">
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="backend, critical, pci"
                  className="input"
                />
                {tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <Badge key={t} tone="lime">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </Field>
            </CardBody>
          </Card>

          {/* Manifest upload */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">Manifest</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Paste a dependency manifest to populate the inventory immediately.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={uploadManifestToggle}
                  onChange={(e) => setUploadManifestToggle(e.target.checked)}
                  className="h-4 w-4 accent-lime-400"
                />
                Upload now
              </label>
            </CardHeader>
            {uploadManifestToggle && (
              <CardBody className="flex flex-col gap-4">
                <Field label="Filename">
                  <input
                    value={manifestFilename}
                    onChange={(e) => setManifestFilename(e.target.value)}
                    placeholder={DEFAULT_MANIFEST[ecosystem]}
                    className="input"
                  />
                </Field>
                <Field label="Content">
                  <textarea
                    value={manifestContent}
                    onChange={(e) => setManifestContent(e.target.value)}
                    placeholder={ecosystem === 'npm' ? SAMPLE_NPM : 'Paste manifest content here...'}
                    rows={12}
                    className="input font-mono text-xs leading-relaxed"
                    spellCheck={false}
                  />
                </Field>
                {ecosystem === 'npm' && (
                  <button
                    type="button"
                    onClick={() => setManifestContent(SAMPLE_NPM)}
                    className="self-start text-xs text-lime-300 hover:underline"
                  >
                    Insert sample package.json
                  </button>
                )}
                {manifestStatus === 'failed' && (
                  <p className="text-xs text-amber-300">Manifest upload failed; the project was still created.</p>
                )}
              </CardBody>
            )}
          </Card>

          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Link href="/dashboard/projects">
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? (createdProject ? 'Uploading manifest...' : 'Creating...') : 'Create Project'}
            </Button>
          </div>
        </form>
      )}

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(64 64 64);
          background-color: rgb(10 10 10);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(245 245 245);
          outline: none;
        }
        :global(.input::placeholder) {
          color: rgb(82 82 82);
        }
        :global(.input:focus) {
          border-color: rgba(132, 204, 22, 0.5);
        }
      `}</style>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
        {required && <span className="text-lime-400">*</span>}
        {hint && <span className="font-normal normal-case tracking-normal text-neutral-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
