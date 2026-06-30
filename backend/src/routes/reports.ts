import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reports,
  workspaces,
  workspace_members,
  updates,
  risk_scores,
  packages,
  projects,
  package_versions,
  package_maintainers,
  maintainers,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Membership / ownership helper.
// ----------------------------------------------------------------------------
async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 }
function gradeRank(grade: string): number {
  return GRADE_ORDER[grade] ?? 99
}

// ----------------------------------------------------------------------------
// Report builders — pure aggregations over workspace data.
// ----------------------------------------------------------------------------

async function buildProjectReport(workspaceId: string, projectId?: string) {
  const conds = [eq(updates.workspace_id, workspaceId)]
  if (projectId) conds.push(eq(updates.project_id, projectId))

  const rows = await db
    .select({
      update_id: updates.id,
      status: updates.status,
      created_at: updates.created_at,
      project_id: projects.id,
      project_name: projects.name,
      ecosystem: projects.ecosystem,
      package_name: packages.name,
      grade: risk_scores.grade,
      total_score: risk_scores.total_score,
    })
    .from(updates)
    .leftJoin(projects, eq(updates.project_id, projects.id))
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(and(...conds))

  const byProject = new Map<
    string,
    {
      project_id: string
      project_name: string | null
      ecosystem: string | null
      total: number
      graded: number
      scoreSum: number
      grades: Record<string, number>
      worst_grade: string | null
      pending: number
      blocked: number
    }
  >()

  for (const r of rows) {
    const key = r.project_id ?? 'unknown'
    if (!byProject.has(key)) {
      byProject.set(key, {
        project_id: key,
        project_name: r.project_name ?? null,
        ecosystem: r.ecosystem ?? null,
        total: 0,
        graded: 0,
        scoreSum: 0,
        grades: { A: 0, B: 0, C: 0, D: 0, F: 0 },
        worst_grade: null,
        pending: 0,
        blocked: 0,
      })
    }
    const p = byProject.get(key)!
    p.total++
    if (r.status === 'pending') p.pending++
    if (r.status === 'blocked' || r.status === 'rejected') p.blocked++
    if (r.grade) {
      p.graded++
      if (p.grades[r.grade] !== undefined) p.grades[r.grade]++
      p.scoreSum += r.total_score ?? 0
      if (!p.worst_grade || gradeRank(r.grade) > gradeRank(p.worst_grade)) p.worst_grade = r.grade
    }
  }

  const projectsOut = Array.from(byProject.values()).map((p) => ({
    project_id: p.project_id,
    project_name: p.project_name,
    ecosystem: p.ecosystem,
    total_updates: p.total,
    graded: p.graded,
    avg_score: p.graded > 0 ? Number((p.scoreSum / p.graded).toFixed(2)) : null,
    worst_grade: p.worst_grade,
    grade_distribution: p.grades,
    pending: p.pending,
    blocked: p.blocked,
  }))

  return {
    kind: 'project',
    project_id: projectId ?? null,
    project_count: projectsOut.length,
    total_updates: rows.length,
    projects: projectsOut,
  }
}

async function buildThroughputReport(workspaceId: string, windowDays = 30) {
  const rows = await db
    .select({
      status: updates.status,
      created_at: updates.created_at,
      updated_at: updates.updated_at,
      grade: risk_scores.grade,
    })
    .from(updates)
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(eq(updates.workspace_id, workspaceId))

  const DAY_MS = 86_400_000
  const cutoff = Date.now() - windowDays * DAY_MS
  const daily = new Map<string, { created: number; resolved: number; auto_cleared: number }>()
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10)
    daily.set(d, { created: 0, resolved: 0, auto_cleared: 0 })
  }

  let created = 0
  let resolved = 0
  let autoCleared = 0
  let resolutionMsSum = 0
  let resolutionCount = 0

  for (const r of rows) {
    const createdAt = r.created_at ? new Date(r.created_at).getTime() : 0
    if (createdAt >= cutoff) {
      created++
      const day = new Date(createdAt).toISOString().slice(0, 10)
      const b = daily.get(day)
      if (b) b.created++
    }
    const isResolved = ['approved', 'rejected', 'auto_cleared', 'blocked'].includes(r.status)
    if (isResolved && r.updated_at) {
      const resolvedAt = new Date(r.updated_at).getTime()
      if (resolvedAt >= cutoff) {
        resolved++
        const day = new Date(resolvedAt).toISOString().slice(0, 10)
        const b = daily.get(day)
        if (b) b.resolved++
        if (r.status === 'auto_cleared') {
          autoCleared++
          if (b) b.auto_cleared++
        }
        if (createdAt > 0 && resolvedAt >= createdAt) {
          resolutionMsSum += resolvedAt - createdAt
          resolutionCount++
        }
      }
    }
  }

  const avgResolutionHours =
    resolutionCount > 0 ? Number((resolutionMsSum / resolutionCount / 3_600_000).toFixed(2)) : null
  const autoClearRate = resolved > 0 ? Number((autoCleared / resolved).toFixed(3)) : 0

  return {
    kind: 'throughput',
    window_days: windowDays,
    created,
    resolved,
    auto_cleared: autoCleared,
    auto_clear_rate: autoClearRate,
    avg_resolution_hours: avgResolutionHours,
    daily: Array.from(daily.entries()).map(([date, v]) => ({ date, ...v })),
  }
}

async function buildMaintainerChangeReport(workspaceId: string) {
  // Surface updates whose target version introduced a maintainer not present on
  // the source version — a key supply-chain risk signal.
  const rows = await db
    .select({
      update_id: updates.id,
      from_version: updates.from_version,
      to_version: updates.to_version,
      status: updates.status,
      package_id: packages.id,
      package_name: packages.name,
      ecosystem: packages.ecosystem,
      grade: risk_scores.grade,
      total_score: risk_scores.total_score,
    })
    .from(updates)
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(eq(updates.workspace_id, workspaceId))

  const changes: Array<Record<string, unknown>> = []

  for (const r of rows) {
    if (!r.package_id) continue
    const fromMaintainers = await maintainersForVersion(r.package_id, r.from_version)
    const toMaintainers = await maintainersForVersion(r.package_id, r.to_version)
    const fromSet = new Set(fromMaintainers.map((m) => m.username))
    const toSet = new Set(toMaintainers.map((m) => m.username))
    const added = toMaintainers.filter((m) => !fromSet.has(m.username))
    const removed = fromMaintainers.filter((m) => !toSet.has(m.username))
    if (added.length === 0 && removed.length === 0) continue
    changes.push({
      update_id: r.update_id,
      package_name: r.package_name,
      ecosystem: r.ecosystem,
      from_version: r.from_version,
      to_version: r.to_version,
      status: r.status,
      grade: r.grade,
      total_score: r.total_score,
      added_maintainers: added.map((m) => ({ username: m.username, trust_score: m.trust_score })),
      removed_maintainers: removed.map((m) => ({ username: m.username, trust_score: m.trust_score })),
      low_trust_introduced: added.some((m) => (m.trust_score ?? 50) < 40),
    })
  }

  changes.sort((a, b) => Number(b.low_trust_introduced) - Number(a.low_trust_introduced))

  return {
    kind: 'maintainer-change',
    total_updates: rows.length,
    flagged: changes.length,
    changes,
  }
}

async function maintainersForVersion(packageId: string, version: string) {
  const [pv] = await db
    .select()
    .from(package_versions)
    .where(and(eq(package_versions.package_id, packageId), eq(package_versions.version, version)))
  if (!pv) return [] as Array<{ username: string; trust_score: number }>
  const rows = await db
    .select({ username: maintainers.username, trust_score: maintainers.trust_score })
    .from(package_maintainers)
    .leftJoin(maintainers, eq(package_maintainers.maintainer_id, maintainers.id))
    .where(eq(package_maintainers.package_version_id, pv.id))
  return rows
    .filter((r) => r.username)
    .map((r) => ({ username: r.username as string, trust_score: r.trust_score ?? 50 }))
}

// ----------------------------------------------------------------------------
// CSV serialization helper for export.
// ----------------------------------------------------------------------------
function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return ''
  const headers = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k))
      return set
    }, new Set<string>()),
  )
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','))
  return lines.join('\n')
}

// Flatten a report's `data` payload into rows suitable for CSV export.
function flattenReportData(type: string, data: Record<string, unknown>): Array<Record<string, unknown>> {
  if (type === 'project' && Array.isArray(data.projects)) return data.projects as Array<Record<string, unknown>>
  if (type === 'throughput' && Array.isArray(data.daily)) return data.daily as Array<Record<string, unknown>>
  if (type === 'maintainer-change' && Array.isArray(data.changes))
    return data.changes as Array<Record<string, unknown>>
  return [data]
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

// GET / — list saved reports for a workspace (public read).
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.workspace_id, workspaceId))
    .orderBy(desc(reports.created_at))
  return c.json(rows)
})

// GET /:id — report detail (public read).
router.get('/:id', async (c) => {
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  return c.json(r)
})

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  type: z.enum(['project', 'throughput', 'maintainer-change']),
  title: z.string().min(1).optional(),
  params: z
    .object({
      project_id: z.string().optional(),
      window_days: z.number().int().positive().max(365).optional(),
    })
    .optional()
    .default({}),
})

// POST /generate — generate a report by type with real aggregation.
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isWorkspaceMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  let data: Record<string, unknown>
  let defaultTitle: string
  switch (body.type) {
    case 'project':
      data = await buildProjectReport(body.workspace_id, body.params?.project_id)
      defaultTitle = 'Project Risk Report'
      break
    case 'throughput':
      data = await buildThroughputReport(body.workspace_id, body.params?.window_days ?? 30)
      defaultTitle = 'Throughput Report'
      break
    case 'maintainer-change':
      data = await buildMaintainerChangeReport(body.workspace_id)
      defaultTitle = 'Maintainer-Change Report'
      break
  }

  const [report] = await db
    .insert(reports)
    .values({
      workspace_id: body.workspace_id,
      type: body.type,
      title: body.title ?? defaultTitle,
      params: body.params ?? {},
      data,
      created_by: userId,
    })
    .returning()
  return c.json(report, 201)
})

// GET /:id/export — export a saved report as json or csv (public read).
router.get('/:id/export', async (c) => {
  const format = (c.req.query('format') ?? 'json').toLowerCase()
  const [r] = await db.select().from(reports).where(eq(reports.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)

  if (format === 'csv') {
    const rows = flattenReportData(r.type, (r.data ?? {}) as Record<string, unknown>)
    const csv = toCsv(rows)
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${r.id}.csv"`,
      },
    })
  }
  return c.json(r)
})

// DELETE /:id — delete a report (auth + ownership).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reports).where(eq(reports.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(reports).where(eq(reports.id, id))
  return c.json({ success: true })
})

export default router
