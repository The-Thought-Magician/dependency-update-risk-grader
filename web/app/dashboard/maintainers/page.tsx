'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Maintainer {
  id: string
  username: string
  display_name?: string | null
  account_created_at?: string | null
  packages_owned?: number | null
  trust_score?: number | null
  prior_incidents?: number | null
  reputation?: string | null
  created_at?: string | null
}

interface OwnedPackage {
  id: string
  name: string
  ecosystem?: string | null
  reputation_tier?: string | null
  weekly_downloads?: number | null
  star_count?: number | null
}

interface MaintainerProfile extends Maintainer {
  packages?: OwnedPackage[]
  owned_packages?: OwnedPackage[]
}

function trustTone(score?: number | null): 'green' | 'lime' | 'amber' | 'red' | 'neutral' {
  if (score == null) return 'neutral'
  if (score >= 80) return 'green'
  if (score >= 60) return 'lime'
  if (score >= 40) return 'amber'
  return 'red'
}

function trustLabel(score?: number | null): string {
  if (score == null) return 'Unrated'
  if (score >= 80) return 'Trusted'
  if (score >= 60) return 'Established'
  if (score >= 40) return 'Watch'
  return 'High risk'
}

function fmtNum(n?: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function accountAgeYears(s?: string | null): number | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365)
}

// Horizontal trust-score bar rendered with plain divs (no chart libs).
function TrustBar({ score }: { score?: number | null }) {
  const v = Math.max(0, Math.min(100, score ?? 0))
  const color =
    v >= 80 ? 'bg-emerald-400' : v >= 60 ? 'bg-pink-400' : v >= 40 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-zinc-400">
        {score == null ? '—' : Math.round(v)}
      </span>
    </div>
  )
}

type SortKey = 'trust_score' | 'packages_owned' | 'prior_incidents' | 'username'

export default function MaintainersPage() {
  const [maintainers, setMaintainers] = useState<Maintainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | 'trusted' | 'established' | 'watch' | 'risk'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('trust_score')
  const [sortAsc, setSortAsc] = useState(false)

  // Detail drawer
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [profile, setProfile] = useState<MaintainerProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  async function load(q?: string) {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listMaintainers(q || undefined)
      setMaintainers(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load maintainers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearch(query.trim())
    load(query.trim())
  }

  async function openProfile(id: string) {
    setSelectedId(id)
    setProfile(null)
    setProfileError(null)
    setProfileLoading(true)
    try {
      const data = await api.getMaintainer(id)
      setProfile(data)
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Failed to load maintainer')
    } finally {
      setProfileLoading(false)
    }
  }

  const filtered = useMemo(() => {
    let list = [...maintainers]
    if (tierFilter !== 'all') {
      list = list.filter((m) => {
        const s = m.trust_score
        if (tierFilter === 'trusted') return (s ?? 0) >= 80
        if (tierFilter === 'established') return (s ?? 0) >= 60 && (s ?? 0) < 80
        if (tierFilter === 'watch') return (s ?? 0) >= 40 && (s ?? 0) < 60
        return (s ?? 0) < 40
      })
    }
    list.sort((a, b) => {
      let av: number | string
      let bv: number | string
      if (sortKey === 'username') {
        av = (a.display_name || a.username || '').toLowerCase()
        bv = (b.display_name || b.username || '').toLowerCase()
      } else {
        av = a[sortKey] ?? 0
        bv = b[sortKey] ?? 0
      }
      if (av < bv) return sortAsc ? -1 : 1
      if (av > bv) return sortAsc ? 1 : -1
      return 0
    })
    return list
  }, [maintainers, tierFilter, sortKey, sortAsc])

  const stats = useMemo(() => {
    const total = maintainers.length
    const trusted = maintainers.filter((m) => (m.trust_score ?? 0) >= 80).length
    const risky = maintainers.filter((m) => (m.trust_score ?? 0) < 40).length
    const incidents = maintainers.reduce((acc, m) => acc + (m.prior_incidents ?? 0), 0)
    const avg = total
      ? Math.round(maintainers.reduce((acc, m) => acc + (m.trust_score ?? 0), 0) / total)
      : 0
    return { total, trusted, risky, incidents, avg }
  }, [maintainers])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(key === 'username')
    }
  }

  const ownedPackages = profile?.packages ?? profile?.owned_packages ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-zinc-100">Maintainer Registry</h1>
        <p className="text-sm text-zinc-500">
          Trust scores, account provenance and prior-incident history for the people behind your
          supply chain.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Maintainers" value={stats.total} />
        <Stat label="Avg trust" value={stats.avg} accent />
        <Stat label="Trusted (80+)" value={stats.trusted} />
        <Stat label="High risk (<40)" value={stats.risky} />
        <Stat label="Prior incidents" value={stats.incidents} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={submitSearch} className="flex w-full max-w-sm items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username or name..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-pink-500/60 focus:outline-none"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
            {search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setQuery('')
                  setSearch('')
                  load()
                }}
              >
                Clear
              </Button>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'trusted', 'established', 'watch', 'risk'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  tierFilter === t
                    ? 'bg-pink-400/15 text-pink-300 ring-1 ring-pink-500/30'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                {t === 'risk' ? 'High risk' : t}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <PageSpinner label="Loading maintainers..." />
          ) : error ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load maintainers"
                description={error}
                action={
                  <Button variant="secondary" onClick={() => load(search)}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={search || tierFilter !== 'all' ? 'No matching maintainers' : 'No maintainers yet'}
                description={
                  search || tierFilter !== 'all'
                    ? 'Try a different search term or filter.'
                    : 'Maintainer records are populated when manifests and package metadata are ingested.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <SortableTH label="Maintainer" active={sortKey === 'username'} asc={sortAsc} onClick={() => toggleSort('username')} />
                  <SortableTH label="Trust" active={sortKey === 'trust_score'} asc={sortAsc} onClick={() => toggleSort('trust_score')} />
                  <TH>Reputation</TH>
                  <SortableTH label="Packages" active={sortKey === 'packages_owned'} asc={sortAsc} onClick={() => toggleSort('packages_owned')} className="text-right" />
                  <SortableTH label="Incidents" active={sortKey === 'prior_incidents'} asc={sortAsc} onClick={() => toggleSort('prior_incidents')} className="text-right" />
                  <TH>Account age</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((m) => {
                  const age = accountAgeYears(m.account_created_at)
                  return (
                    <TR key={m.id} className="cursor-pointer" onClick={() => openProfile(m.id)}>
                      <TD>
                        <div className="font-medium text-zinc-100">{m.display_name || m.username}</div>
                        <div className="text-xs text-zinc-500">@{m.username}</div>
                      </TD>
                      <TD>
                        <TrustBar score={m.trust_score} />
                      </TD>
                      <TD>
                        <Badge tone={trustTone(m.trust_score)}>{m.reputation || trustLabel(m.trust_score)}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{m.packages_owned ?? 0}</TD>
                      <TD className="text-right tabular-nums">
                        {m.prior_incidents ? (
                          <span className="text-red-300">{m.prior_incidents}</span>
                        ) : (
                          <span className="text-zinc-500">0</span>
                        )}
                      </TD>
                      <TD className="text-xs text-zinc-400">
                        {age == null ? '—' : age < 1 ? `${Math.round(age * 12)}mo` : `${age.toFixed(1)}y`}
                      </TD>
                      <TD className="text-right">
                        <span className="text-xs text-pink-400">View →</span>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        title={profile ? profile.display_name || profile.username : 'Maintainer'}
        className="max-w-2xl"
      >
        {profileLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : profileError ? (
          <EmptyState
            title="Could not load profile"
            description={profileError}
            action={
              selectedId ? (
                <Button variant="secondary" onClick={() => openProfile(selectedId)}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        ) : profile ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-400">@{profile.username}</span>
              <Badge tone={trustTone(profile.trust_score)}>{profile.reputation || trustLabel(profile.trust_score)}</Badge>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Trust score</div>
              <TrustBar score={profile.trust_score} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Packages" value={profile.packages_owned ?? ownedPackages.length} />
              <Stat label="Incidents" value={profile.prior_incidents ?? 0} />
              <Stat
                label="Account"
                value={(() => {
                  const a = accountAgeYears(profile.account_created_at)
                  return a == null ? '—' : a < 1 ? `${Math.round(a * 12)}mo` : `${a.toFixed(1)}y`
                })()}
                hint={fmtDate(profile.account_created_at)}
              />
              <Stat label="Trust" value={profile.trust_score == null ? '—' : Math.round(profile.trust_score)} accent />
            </div>

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Owned packages ({ownedPackages.length})
              </div>
              {ownedPackages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center text-sm text-zinc-500">
                  No package ownership records.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800">
                  <ul className="divide-y divide-zinc-800">
                    {ownedPackages.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div>
                          <div className="text-sm font-medium text-zinc-100">{p.name}</div>
                          <div className="text-xs text-zinc-500">
                            {p.ecosystem || '—'}
                            {p.reputation_tier ? ` · ${p.reputation_tier}` : ''}
                          </div>
                        </div>
                        <div className="text-right text-xs text-zinc-400">
                          <div>{fmtNum(p.weekly_downloads)} dl/wk</div>
                          <div>★ {fmtNum(p.star_count)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function SortableTH({
  label,
  active,
  asc,
  onClick,
  className = '',
}: {
  label: string
  active: boolean
  asc: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <TH className={className}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors hover:text-zinc-200 ${
          active ? 'text-pink-300' : ''
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (asc ? '▲' : '▼') : '↕'}</span>
      </button>
    </TH>
  )
}
