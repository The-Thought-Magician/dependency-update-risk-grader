'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Package = {
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
  created_at?: string
}

const ECOSYSTEMS = ['', 'npm', 'pypi', 'cargo', 'maven', 'go', 'rubygems', 'nuget']
const TIER_TONE: Record<string, 'green' | 'lime' | 'amber' | 'neutral'> = {
  popular: 'green',
  established: 'lime',
  niche: 'amber',
  unknown: 'neutral',
}
type SortKey = 'downloads' | 'stars' | 'name' | 'trend'

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function Trend({ v }: { v: number }) {
  if (v > 0.02) return <span className="text-emerald-400">▲ {(v * 100).toFixed(0)}%</span>
  if (v < -0.02) return <span className="text-red-400">▼ {(Math.abs(v) * 100).toFixed(0)}%</span>
  return <span className="text-neutral-500">– flat</span>
}

export default function PackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [ecosystem, setEcosystem] = useState('')
  const [sort, setSort] = useState<SortKey>('downloads')
  const [riskyOnly, setRiskyOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await api.listPackages({
        ecosystem: ecosystem || undefined,
        q: q.trim() || undefined,
      })
      setPackages(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load packages')
    } finally {
      setLoading(false)
    }
  }, [ecosystem, q])

  // Initial + ecosystem-change load.
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ecosystem])

  // Debounced server search on query change.
  useEffect(() => {
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const view = useMemo(() => {
    let rows = packages
    if (riskyOnly) rows = rows.filter((p) => p.is_deprecated || p.is_archived || p.typosquat_suspect)
    const sorted = [...rows].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'stars':
          return b.star_count - a.star_count
        case 'trend':
          return b.download_trend - a.download_trend
        default:
          return b.weekly_downloads - a.weekly_downloads
      }
    })
    return sorted
  }, [packages, riskyOnly, sort])

  const riskyCount = packages.filter((p) => p.is_deprecated || p.is_archived || p.typosquat_suspect).length
  const totalDownloads = packages.reduce((s, p) => s + (p.weekly_downloads || 0), 0)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">Package intelligence</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Reputation, popularity, maintenance signals, and supply-chain risk flags across observed packages.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Packages" value={packages.length} accent />
        <Stat label="Flagged" value={riskyCount} hint="deprecated / archived / typosquat" />
        <Stat label="Weekly downloads" value={fmt(totalDownloads)} />
        <Stat label="Ecosystem" value={ecosystem || 'all'} />
      </div>

      {/* Controls */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search packages by name..."
              className="min-w-[200px] flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-lime-500/50 focus:outline-none"
            />
            <select
              value={ecosystem}
              onChange={(e) => setEcosystem(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              {ECOSYSTEMS.map((e) => (
                <option key={e || 'all'} value={e}>
                  {e || 'All ecosystems'}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-lime-500/50 focus:outline-none"
            >
              <option value="downloads">Sort: downloads</option>
              <option value="stars">Sort: stars</option>
              <option value="trend">Sort: trend</option>
              <option value="name">Sort: name</option>
            </select>
            <button
              onClick={() => setRiskyOnly((v) => !v)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                riskyOnly
                  ? 'border-red-500/40 bg-red-500/15 text-red-300'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Flagged only
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Table */}
      {loading ? (
        <PageSpinner label="Loading packages..." />
      ) : error ? (
        <EmptyState
          title="Could not load packages"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      ) : view.length === 0 ? (
        <EmptyState
          title={packages.length === 0 ? 'No packages observed yet' : 'No matches'}
          description={
            packages.length === 0
              ? 'Packages populate as project manifests are uploaded and updates are graded.'
              : 'Try a different search term or clear the flagged-only filter.'
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-200">
              {view.length} package{view.length === 1 ? '' : 's'}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Package</TH>
                  <TH>Reputation</TH>
                  <TH className="text-right">Weekly DL</TH>
                  <TH className="text-right">Trend</TH>
                  <TH className="text-right">Stars</TH>
                  <TH className="text-right">Contributors</TH>
                  <TH>Flags</TH>
                </TR>
              </THead>
              <TBody>
                {view.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/dashboard/packages/${p.id}`}
                        className="font-medium text-neutral-100 hover:text-lime-300"
                      >
                        {p.name}
                      </Link>
                      <span className="ml-2 text-xs text-neutral-600">{p.ecosystem}</span>
                    </TD>
                    <TD>
                      <Badge tone={TIER_TONE[p.reputation_tier] ?? 'neutral'}>{p.reputation_tier}</Badge>
                    </TD>
                    <TD className="text-right font-mono text-xs">{fmt(p.weekly_downloads)}</TD>
                    <TD className="text-right text-xs">
                      <Trend v={p.download_trend} />
                    </TD>
                    <TD className="text-right font-mono text-xs">{fmt(p.star_count)}</TD>
                    <TD className="text-right font-mono text-xs">{p.contributor_count}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {p.is_deprecated && <Badge tone="red">deprecated</Badge>}
                        {p.is_archived && <Badge tone="amber">archived</Badge>}
                        {p.typosquat_suspect && <Badge tone="red">typosquat?</Badge>}
                        {!p.is_deprecated && !p.is_archived && !p.typosquat_suspect && (
                          <span className="text-xs text-neutral-600">clean</span>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
