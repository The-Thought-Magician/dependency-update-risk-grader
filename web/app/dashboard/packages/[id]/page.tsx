'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, GradeBadge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Pkg = {
  id: string
  name: string
  ecosystem: string
  reputation_tier: string
  weekly_downloads: number
  download_trend: number
  star_count: number
  contributor_count: number
  repo_url?: string | null
  is_deprecated: boolean
  is_archived: boolean
  typosquat_suspect: boolean
  // profile may inline these
  versions?: PkgVersion[]
  maintainers?: Maintainer[]
  cadence?: Record<string, number> | null
  package?: Pkg
}

type PkgVersion = {
  id: string
  version: string
  published_at?: string | null
  published_hour?: number | null
  has_provenance: boolean
  signature_present: boolean
  slsa_level: number
  publisher_2fa: boolean
  install_scripts?: Record<string, string> | null
  file_count: number
  lines_added: number
  lines_removed: number
  tarball_matches_repo: boolean
  dependencies?: Record<string, string> | null
  grade?: string | null
}

type Maintainer = {
  id: string
  username: string
  display_name?: string | null
  account_created_at?: string | null
  packages_owned: number
  trust_score: number
  prior_incidents: number
  reputation: string
  role?: string | null
}

const TIER_TONE: Record<string, 'green' | 'lime' | 'amber' | 'neutral'> = {
  popular: 'green',
  established: 'lime',
  niche: 'amber',
  unknown: 'neutral',
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function trustTone(score: number): 'green' | 'lime' | 'amber' | 'red' {
  if (score >= 80) return 'green'
  if (score >= 60) return 'lime'
  if (score >= 40) return 'amber'
  return 'red'
}

export default function PackageProfilePage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [pkg, setPkg] = useState<Pkg | null>(null)
  const [versions, setVersions] = useState<PkgVersion[]>([])
  const [maintainers, setMaintainers] = useState<Maintainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [p, v, m] = await Promise.all([
        api.getPackage(id),
        api.getPackageVersions(id).catch(() => []),
        api.getPackageMaintainers(id).catch(() => []),
      ])
      const resolved: Pkg = p && p.package ? { ...p.package, ...p } : p
      setPkg(resolved)
      const vRows = Array.isArray(v) && v.length ? v : resolved?.versions ?? []
      const mRows = Array.isArray(m) && m.length ? m : resolved?.maintainers ?? []
      setVersions(Array.isArray(vRows) ? vRows : [])
      setMaintainers(Array.isArray(mRows) ? mRows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load package')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Release cadence: count of versions published per calendar month.
  const cadence = useMemo(() => {
    const map = new Map<string, number>()
    for (const v of versions) {
      if (!v.published_at) continue
      const d = new Date(v.published_at)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [versions])

  // Publish-hour distribution (off-hours publishing is a supply-chain signal).
  const hourHistogram = useMemo(() => {
    const buckets = new Array(24).fill(0) as number[]
    for (const v of versions) {
      const h = v.published_hour ?? (v.published_at ? new Date(v.published_at).getUTCHours() : null)
      if (h != null && h >= 0 && h < 24) buckets[h] += 1
    }
    return buckets
  }, [versions])

  if (loading) return <PageSpinner label="Loading package..." />

  if (error || !pkg) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          title="Could not load package"
          description={error ?? 'This package may not exist.'}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
              <Link href="/dashboard/packages">
                <Button variant="ghost">Back to packages</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  const flagged = pkg.is_deprecated || pkg.is_archived || pkg.typosquat_suspect

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/packages" className="text-xs text-neutral-500 hover:text-lime-300">
          ← Packages
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-all text-2xl font-semibold tracking-tight text-neutral-100">{pkg.name}</h1>
              <Badge tone="lime">{pkg.ecosystem}</Badge>
              <Badge tone={TIER_TONE[pkg.reputation_tier] ?? 'neutral'}>{pkg.reputation_tier}</Badge>
            </div>
            {pkg.repo_url ? (
              <a
                href={pkg.repo_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block break-all text-sm text-neutral-400 hover:text-lime-300"
              >
                {pkg.repo_url}
              </a>
            ) : (
              <p className="mt-1 text-sm text-neutral-600">No repository linked</p>
            )}
          </div>
          {flagged && (
            <div className="flex flex-wrap gap-1.5">
              {pkg.is_deprecated && <Badge tone="red">deprecated</Badge>}
              {pkg.is_archived && <Badge tone="amber">archived</Badge>}
              {pkg.typosquat_suspect && <Badge tone="red">typosquat suspect</Badge>}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Weekly DL" value={fmt(pkg.weekly_downloads)} accent />
        <Stat
          label="Trend"
          value={`${pkg.download_trend > 0 ? '+' : ''}${(pkg.download_trend * 100).toFixed(0)}%`}
        />
        <Stat label="Stars" value={fmt(pkg.star_count)} />
        <Stat label="Contributors" value={pkg.contributor_count} />
        <Stat label="Versions" value={versions.length} />
      </div>

      {/* Cadence chart */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Release cadence</h2>
        </CardHeader>
        <CardBody>
          {cadence.length === 0 ? (
            <p className="text-sm text-neutral-500">No dated version history available for cadence analysis.</p>
          ) : (
            <CadenceChart data={cadence} />
          )}
        </CardBody>
      </Card>

      {/* Publish-hour histogram */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Publish-hour distribution (UTC)</h2>
        </CardHeader>
        <CardBody>
          {hourHistogram.every((n) => n === 0) ? (
            <p className="text-sm text-neutral-500">No publish-time data available.</p>
          ) : (
            <HourHistogram buckets={hourHistogram} />
          )}
          <p className="mt-2 text-xs text-neutral-600">
            Clusters of off-hours publishes can indicate compromised or automated releases.
          </p>
        </CardBody>
      </Card>

      {/* Versions */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Version history</h2>
        </CardHeader>
        <CardBody className="p-0">
          {versions.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState title="No versions recorded" description="Version intelligence appears once this package is observed in graded updates." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Version</TH>
                  <TH>Published</TH>
                  <TH>Provenance</TH>
                  <TH>Signed</TH>
                  <TH>2FA</TH>
                  <TH className="text-right">SLSA</TH>
                  <TH className="text-right">Diff (+/-)</TH>
                  <TH>Repo match</TH>
                  <TH>Scripts</TH>
                  <TH>Grade</TH>
                </TR>
              </THead>
              <TBody>
                {versions.map((v) => {
                  const scriptCount = v.install_scripts ? Object.keys(v.install_scripts).length : 0
                  return (
                    <TR key={v.id}>
                      <TD className="font-mono text-xs font-medium text-neutral-100">{v.version}</TD>
                      <TD className="text-xs text-neutral-500">
                        {v.published_at ? new Date(v.published_at).toLocaleDateString() : '—'}
                      </TD>
                      <TD>{v.has_provenance ? <Badge tone="green">yes</Badge> : <Badge tone="neutral">no</Badge>}</TD>
                      <TD>{v.signature_present ? <Badge tone="green">yes</Badge> : <Badge tone="neutral">no</Badge>}</TD>
                      <TD>{v.publisher_2fa ? <Badge tone="green">yes</Badge> : <Badge tone="amber">no</Badge>}</TD>
                      <TD className="text-right font-mono text-xs">L{v.slsa_level}</TD>
                      <TD className="text-right font-mono text-xs">
                        <span className="text-emerald-400">+{v.lines_added}</span>{' '}
                        <span className="text-red-400">-{v.lines_removed}</span>
                      </TD>
                      <TD>
                        {v.tarball_matches_repo ? (
                          <Badge tone="green">match</Badge>
                        ) : (
                          <Badge tone="red">mismatch</Badge>
                        )}
                      </TD>
                      <TD>
                        {scriptCount > 0 ? (
                          <Badge tone="amber">{scriptCount} hook{scriptCount === 1 ? '' : 's'}</Badge>
                        ) : (
                          <span className="text-xs text-neutral-600">none</span>
                        )}
                      </TD>
                      <TD>{v.grade ? <GradeBadge grade={v.grade} /> : <span className="text-neutral-600">—</span>}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Maintainers */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Maintainers</h2>
        </CardHeader>
        <CardBody className="p-0">
          {maintainers.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyState title="No maintainers recorded" description="Maintainer ownership data appears as version publishers are observed." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Maintainer</TH>
                  <TH>Role</TH>
                  <TH>Reputation</TH>
                  <TH className="text-right">Trust</TH>
                  <TH className="text-right">Packages</TH>
                  <TH className="text-right">Prior incidents</TH>
                  <TH>Account age</TH>
                </TR>
              </THead>
              <TBody>
                {maintainers.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <Link
                        href={`/dashboard/maintainers?focus=${m.id}`}
                        className="font-medium text-neutral-100 hover:text-lime-300"
                      >
                        {m.display_name || m.username}
                      </Link>
                      {m.display_name && <span className="ml-2 text-xs text-neutral-600">@{m.username}</span>}
                    </TD>
                    <TD className="text-xs text-neutral-400">{m.role || 'publisher'}</TD>
                    <TD>
                      <Badge tone="neutral">{m.reputation}</Badge>
                    </TD>
                    <TD className="text-right">
                      <Badge tone={trustTone(m.trust_score)}>{m.trust_score.toFixed(0)}</Badge>
                    </TD>
                    <TD className="text-right font-mono text-xs">{m.packages_owned}</TD>
                    <TD className="text-right font-mono text-xs">
                      {m.prior_incidents > 0 ? (
                        <span className="text-red-400">{m.prior_incidents}</span>
                      ) : (
                        <span className="text-neutral-500">0</span>
                      )}
                    </TD>
                    <TD className="text-xs text-neutral-500">
                      {m.account_created_at ? new Date(m.account_created_at).toLocaleDateString() : '—'}
                    </TD>
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

function CadenceChart({ data }: { data: (readonly [string, number])[] }) {
  const max = Math.max(1, ...data.map(([, n]) => n))
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
      {data.map(([month, n]) => (
        <div key={month} className="flex min-w-[28px] flex-col items-center gap-1">
          <span className="text-[10px] font-medium text-neutral-400">{n}</span>
          <div className="flex h-24 w-full items-end">
            <div
              className="w-full rounded-t bg-lime-400/80 transition-all hover:bg-lime-300"
              style={{ height: `${(n / max) * 100}%` }}
              title={`${month}: ${n} release${n === 1 ? '' : 's'}`}
            />
          </div>
          <span className="whitespace-nowrap text-[9px] text-neutral-600">{month.slice(2)}</span>
        </div>
      ))}
    </div>
  )
}

function HourHistogram({ buckets }: { buckets: number[] }) {
  const max = Math.max(1, ...buckets)
  return (
    <div className="flex items-end gap-1" style={{ minHeight: 90 }}>
      {buckets.map((n, h) => {
        const offHours = h < 6 || h >= 22
        return (
          <div key={h} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end">
              <div
                className={`w-full rounded-t ${offHours ? 'bg-amber-400/80' : 'bg-neutral-600'}`}
                style={{ height: n === 0 ? '2px' : `${(n / max) * 100}%` }}
                title={`${h}:00 UTC — ${n} release${n === 1 ? '' : 's'}`}
              />
            </div>
            {h % 3 === 0 && <span className="text-[9px] text-neutral-600">{h}</span>}
          </div>
        )
      })}
    </div>
  )
}
