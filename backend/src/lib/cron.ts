// ----------------------------------------------------------------------------
// cron.ts — deterministic schedule engine.
//
// Pure, self-contained functions for validating, describing, projecting and
// analyzing recurring schedules. No network, no DB, no external services.
//
// Three schedule "kinds" are supported:
//   - 'cron'   : a standard 5-field cron expression, evaluated with cron-parser.
//   - 'rate'   : a natural-language rate, e.g. "every 5 minutes", "every 2 hours",
//                "every 1 days". Computed arithmetically.
//   - 'oneoff' : a single ISO instant. Fires once if it is in the future.
// ----------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CronJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  gapStart: string
  gapEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// ----------------------------------------------------------------------------
// Rate parsing helpers
// ----------------------------------------------------------------------------

interface ParsedRate {
  n: number
  unit: 'minutes' | 'hours' | 'days'
  ms: number
}

function parseRate(expr: string): ParsedRate | null {
  // "every N minutes|hours|days" (singular units tolerated).
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^every\s+(\d+)\s*(minute|minutes|hour|hours|day|days)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const raw = m[2]
  if (raw.startsWith('minute')) return { n, unit: 'minutes', ms: n * MINUTE_MS }
  if (raw.startsWith('hour')) return { n, unit: 'hours', ms: n * HOUR_MS }
  return { n, unit: 'days', ms: n * DAY_MS }
}

function parseOneoff(expr: string): Date | null {
  const d = new Date(expr.trim())
  if (Number.isNaN(d.getTime())) return null
  return d
}

// ----------------------------------------------------------------------------
// validateExpression
// ----------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || !expr.trim()) return { valid: false, error: 'Expression is empty' }
  switch (kind) {
    case 'cron': {
      try {
        CronExpressionParser.parse(expr)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'rate': {
      const r = parseRate(expr)
      if (!r) return { valid: false, error: 'Expected "every N minutes|hours|days"' }
      return { valid: true }
    }
    case 'oneoff': {
      const d = parseOneoff(expr)
      if (!d) return { valid: false, error: 'Expected an ISO date-time' }
      return { valid: true }
    }
    default:
      return { valid: false, error: `Unknown kind: ${kind}` }
  }
}

// ----------------------------------------------------------------------------
// describeExpression
// ----------------------------------------------------------------------------

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid schedule: ${v.error}`

  if (kind === 'rate') {
    const r = parseRate(expr)!
    const unit = r.n === 1 ? r.unit.replace(/s$/, '') : r.unit
    return `Every ${r.n} ${unit} (${timezone})`
  }

  if (kind === 'oneoff') {
    const d = parseOneoff(expr)!
    return `Once at ${d.toISOString()} (${timezone})`
  }

  // cron
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return `Cron schedule "${expr}" (${timezone})`
  const [min, hour, dom, mon, dow] = parts

  // Common friendly cases.
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every minute (${timezone})`
  }
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} minutes (${timezone})`
  }
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Hourly at :${min.padStart(2, '0')} (${timezone})`
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} (${timezone})`
  }
  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === '*' &&
    mon === '*' &&
    /^\d+$/.test(dow)
  ) {
    const day = DOW_NAMES[parseInt(dow, 10) % 7]
    return `Weekly on ${day} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} (${timezone})`
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && mon === '*' && dow === '*') {
    return `Monthly on day ${dom} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} (${timezone})`
  }
  return `Cron "${expr}" (${timezone})`
}

// ----------------------------------------------------------------------------
// nextFirings
// ----------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 5,
): string[] {
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  if (kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        out.push(interval.next().toDate().toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.ms
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.ms
    }
    return out
  }

  if (kind === 'oneoff') {
    const d = parseOneoff(expr)
    if (!d) return []
    return d.getTime() > from.getTime() ? [d.toISOString()] : []
  }

  return []
}

// ----------------------------------------------------------------------------
// Internal: collect every firing for a job within a horizon window.
// ----------------------------------------------------------------------------

function firingsWithin(job: CronJob, from: Date, horizonDays: number): Date[] {
  const end = from.getTime() + horizonDays * DAY_MS
  const tz = job.timezone ?? 'UTC'
  const out: Date[] = []
  const HARD_CAP = 100_000

  if (job.kind === 'cron') {
    try {
      const interval = CronExpressionParser.parse(job.expr, { tz, currentDate: from })
      for (let i = 0; i < HARD_CAP; i++) {
        const next = interval.next().toDate()
        if (next.getTime() > end) break
        out.push(next)
      }
    } catch {
      /* invalid cron -> no firings */
    }
    return out
  }

  if (job.kind === 'rate') {
    const r = parseRate(job.expr)
    if (!r) return out
    let t = from.getTime() + r.ms
    let guard = 0
    while (t <= end && guard < HARD_CAP) {
      out.push(new Date(t))
      t += r.ms
      guard++
    }
    return out
  }

  if (job.kind === 'oneoff') {
    const d = parseOneoff(job.expr)
    if (d && d.getTime() > from.getTime() && d.getTime() <= end) out.push(d)
    return out
  }

  return out
}

// Floor a Date to its minute as an ISO string (zero seconds/ms).
function minuteBucketISO(d: Date): string {
  const t = Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS
  return new Date(t).toISOString()
}

// ----------------------------------------------------------------------------
// computeCollisions
// ----------------------------------------------------------------------------

export function computeCollisions(
  jobs: CronJob[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 3
  const from = new Date()

  // bucket -> set of jobIds firing in that minute
  const byMinute = new Map<string, Set<string>>()
  // bucket -> resourceId -> set of jobIds (for resource-contention detection)
  const byMinuteResource = new Map<string, Map<string, Set<string>>>()

  for (const job of jobs) {
    const firings = firingsWithin(job, from, horizonDays)
    for (const f of firings) {
      const bucket = minuteBucketISO(f)
      if (!byMinute.has(bucket)) byMinute.set(bucket, new Set())
      byMinute.get(bucket)!.add(job.id)
      if (job.resourceId) {
        if (!byMinuteResource.has(bucket)) byMinuteResource.set(bucket, new Map())
        const rm = byMinuteResource.get(bucket)!
        if (!rm.has(job.resourceId)) rm.set(job.resourceId, new Set())
        rm.get(job.resourceId)!.add(job.id)
      }
    }
  }

  const windows: CollisionWindow[] = []

  for (const [bucket, ids] of byMinute) {
    const concurrency = ids.size
    // resource contention: >=2 jobs sharing a resource in this minute
    let contendedResource: string | undefined
    let contendedIds: Set<string> | undefined
    const rm = byMinuteResource.get(bucket)
    if (rm) {
      for (const [resId, rIds] of rm) {
        if (rIds.size >= 2) {
          contendedResource = resId
          contendedIds = rIds
          break
        }
      }
    }

    const flaggedByConcurrency = concurrency >= threshold
    const flaggedByResource = !!contendedResource

    if (!flaggedByConcurrency && !flaggedByResource) continue

    const start = new Date(bucket)
    const end = new Date(start.getTime() + MINUTE_MS)

    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 2) severity = 'high'
    else if (flaggedByConcurrency) severity = 'medium'
    else severity = 'low'

    windows.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: Array.from(flaggedByResource && contendedIds ? contendedIds : ids).sort(),
      severity,
      resourceId: contendedResource,
    })
  }

  windows.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return windows
}

// ----------------------------------------------------------------------------
// loadHeatmap — firings bucketed by hour across the horizon.
// ----------------------------------------------------------------------------

export function loadHeatmap(
  jobs: CronJob[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const counts = new Map<string, number>()

  for (const job of jobs) {
    const firings = firingsWithin(job, from, horizonDays)
    for (const f of firings) {
      const t = Math.floor(f.getTime() / HOUR_MS) * HOUR_MS
      const bucket = new Date(t).toISOString()
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ----------------------------------------------------------------------------
// dstTraps — detect DST transitions over the window for a single schedule's tz.
//
// We sample the timezone's UTC offset day by day. When the offset changes
// between consecutive days a DST transition occurred:
//   - offset increases (spring forward) -> a local-time gap exists -> 'skip'
//     firings whose local time lands in the skipped hour are lost.
//   - offset decreases (fall back)      -> a local hour repeats -> 'double_fire'
//     / 'ambiguous' — wall-clock firings in that hour run twice.
// ----------------------------------------------------------------------------

function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Offset = (wall-clock interpreted as UTC) - actual UTC instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
  }
  let hour = map.hour
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
  return Math.round((asUtc - date.getTime()) / MINUTE_MS)
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  if (timezone === 'UTC') return []
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []

  // Find transition instants by scanning day boundaries for offset changes.
  const traps: DstTrap[] = []
  const transitions: Array<{ at: Date; deltaMin: number }> = []
  let prevOffset = tzOffsetMinutes(from, timezone)

  for (let d = 1; d <= days; d++) {
    const at = new Date(from.getTime() + d * DAY_MS)
    const off = tzOffsetMinutes(at, timezone)
    if (off !== prevOffset) {
      transitions.push({ at, deltaMin: off - prevOffset })
      prevOffset = off
    }
  }

  if (transitions.length === 0) return []

  // The set of local wall-clock firing times this schedule produces, used to
  // tell whether a transition actually traps a firing.
  const firings = firingsWithin({ id: '_', kind, expr, timezone }, from, days)
  const firingLocalKeys = new Set<string>()
  for (const f of firings) {
    firingLocalKeys.add(localHourMinuteKey(f, timezone))
  }

  for (const tr of transitions) {
    // Refine to the transition hour for reporting.
    const atUtc = tr.at.toISOString()
    const atLocal = formatLocal(tr.at, timezone)
    if (tr.deltaMin > 0) {
      // spring forward -> skipped local hour
      traps.push({ type: 'skip', atLocal, atUtc })
    } else {
      // fall back -> ambiguous / repeated local hour
      traps.push({ type: 'ambiguous', atLocal, atUtc })
      if (firingLocalKeys.size > 0) {
        traps.push({ type: 'double_fire', atLocal, atUtc })
      }
    }
  }

  return traps
}

function localHourMinuteKey(d: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  return dtf.format(d)
}

function formatLocal(d: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return dtf.format(d).replace(' ', 'T')
}

// ----------------------------------------------------------------------------
// coverageGaps — given existing coverage windows + jobs, find spans in the
// horizon with no firing/coverage. Windows are [start,end) ISO pairs.
// ----------------------------------------------------------------------------

export function coverageGaps(
  windows: Array<{ windowStart: string; windowEnd: string }>,
  jobs: CronJob[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const horizonEnd = from.getTime() + horizonDays * DAY_MS

  // Build intervals from explicit windows.
  const intervals: Array<[number, number]> = []
  for (const w of windows) {
    const s = new Date(w.windowStart).getTime()
    const e = new Date(w.windowEnd).getTime()
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) intervals.push([s, e])
  }
  // Each job firing covers the minute it runs in.
  for (const job of jobs) {
    for (const f of firingsWithin(job, from, horizonDays)) {
      const s = Math.floor(f.getTime() / MINUTE_MS) * MINUTE_MS
      intervals.push([s, s + MINUTE_MS])
    }
  }

  if (intervals.length === 0) {
    return [
      {
        gapStart: from.toISOString(),
        gapEnd: new Date(horizonEnd).toISOString(),
        durationMinutes: Math.round((horizonEnd - from.getTime()) / MINUTE_MS),
      },
    ]
  }

  // Merge intervals, then find gaps between them within [from, horizonEnd].
  intervals.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv[0] <= last[1]) {
      last[1] = Math.max(last[1], iv[1])
    } else {
      merged.push([iv[0], iv[1]])
    }
  }

  const gaps: CoverageGap[] = []
  let cursor = from.getTime()
  for (const [s, e] of merged) {
    if (s > cursor) {
      const gapEnd = Math.min(s, horizonEnd)
      if (gapEnd > cursor) {
        gaps.push({
          gapStart: new Date(cursor).toISOString(),
          gapEnd: new Date(gapEnd).toISOString(),
          durationMinutes: Math.round((gapEnd - cursor) / MINUTE_MS),
        })
      }
    }
    cursor = Math.max(cursor, e)
    if (cursor >= horizonEnd) break
  }
  if (cursor < horizonEnd) {
    gaps.push({
      gapStart: new Date(cursor).toISOString(),
      gapEnd: new Date(horizonEnd).toISOString(),
      durationMinutes: Math.round((horizonEnd - cursor) / MINUTE_MS),
    })
  }

  return gaps
}

// ----------------------------------------------------------------------------
// autoSpread — for jobs that collide, suggest a staggered cron expression.
//
// Jobs sharing a firing minute (concurrency >= threshold) get nudged: each
// colliding job after the first is offset by a deterministic minute so the
// fleet spreads across the hour.
// ----------------------------------------------------------------------------

export function autoSpread(
  jobs: CronJob[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 3
  const horizonDays = opts.horizonDays ?? 1
  const collisions = computeCollisions(jobs, { horizonDays, threshold })

  const suggestions: SpreadSuggestion[] = []
  const seen = new Set<string>()
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  for (const win of collisions) {
    // Keep the first job on its schedule; spread the rest.
    const colliding = win.jobIds
    for (let i = 1; i < colliding.length; i++) {
      const jobId = colliding[i]
      if (seen.has(jobId)) continue
      const job = jobById.get(jobId)
      if (!job || job.kind !== 'cron') {
        if (job && job.kind === 'rate') {
          seen.add(jobId)
          suggestions.push({
            jobId,
            suggestedExpr: offsetRateExpr(job.expr, i),
            reason: win.resourceId
              ? `Shares resource "${win.resourceId}" with ${colliding.length - 1} other job(s) at ${win.windowStart}; stagger to reduce contention.`
              : `Collides with ${colliding.length - 1} other job(s) at ${win.windowStart}; stagger start.`,
          })
        }
        continue
      }
      const offsetMinute = (i * 7) % 60 // deterministic prime-ish stagger
      const suggested = setCronMinute(job.expr, offsetMinute)
      seen.add(jobId)
      suggestions.push({
        jobId,
        suggestedExpr: suggested,
        reason: win.resourceId
          ? `Shares resource "${win.resourceId}" with ${colliding.length - 1} other job(s) at ${win.windowStart}; shift to minute ${offsetMinute}.`
          : `Concurrency ${colliding.length} at ${win.windowStart} exceeds threshold ${threshold}; shift to minute ${offsetMinute}.`,
      })
    }
  }

  return suggestions
}

function setCronMinute(expr: string, minute: number): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  parts[0] = String(minute)
  return parts.join(' ')
}

function offsetRateExpr(expr: string, offsetUnits: number): string {
  // For a rate job we cannot stagger within the rate string itself; suggest a
  // cron equivalent offset for clarity where it is minute-based.
  const r = parseRate(expr)
  if (!r) return expr
  if (r.unit === 'minutes') return `${offsetUnits % 60} */${r.n} * * *`.trim()
  return expr
}
