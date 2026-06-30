import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  projects,
  workspaces,
  workspace_members,
  dependencies,
  packages,
  updates,
  risk_scores,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1).max(160),
  ecosystem: z.string().min(1).max(40).optional(),
  repo_url: z.string().url().optional().or(z.literal('')).optional(),
  tags: z.array(z.string()).optional().default([]),
})

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  ecosystem: z.string().min(1).max(40).optional(),
  repo_url: z.string().url().nullable().optional().or(z.literal('')),
  tags: z.array(z.string()).optional(),
})

// Ownership check: caller is workspace owner or owner/admin member.
async function canWrite(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m && (m.role === 'owner' || m.role === 'admin' || m.role === 'reviewer')
}

// GET / — public — ?workspace_id= list projects
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const rows = workspaceId
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.workspace_id, workspaceId))
        .orderBy(desc(projects.created_at))
    : await db.select().from(projects).orderBy(desc(projects.created_at))
  return c.json(rows)
})

// GET /:id — public — project detail (with live dependency_count)
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [proj] = await db.select().from(projects).where(eq(projects.id, id))
  if (!proj) return c.json({ error: 'Not found' }, 404)
  const deps = await db.select().from(dependencies).where(eq(dependencies.project_id, id))
  return c.json({ ...proj, dependency_count: deps.length })
})

// POST / — auth — create project
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await canWrite(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [proj] = await db
    .insert(projects)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      ecosystem: body.ecosystem ?? 'npm',
      repo_url: body.repo_url || null,
      tags: body.tags ?? [],
      dependency_count: 0,
      created_by: userId,
    })
    .returning()
  return c.json(proj, 201)
})

// PUT /:id — auth — update project
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(projects).where(eq(projects.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await canWrite(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.ecosystem !== undefined) patch.ecosystem = body.ecosystem
  if (body.repo_url !== undefined) patch.repo_url = body.repo_url || null
  if (body.tags !== undefined) patch.tags = body.tags

  const [updated] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete project + its dependencies
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(projects).where(eq(projects.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await canWrite(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(dependencies).where(eq(dependencies.project_id, id))
  await db.delete(projects).where(eq(projects.id, id))
  return c.json({ success: true })
})

// GET /:id/dependencies — public — inventory for project (joined with package profile)
router.get('/:id/dependencies', async (c) => {
  const id = c.req.param('id')
  const [proj] = await db.select().from(projects).where(eq(projects.id, id))
  if (!proj) return c.json({ error: 'Not found' }, 404)

  const rows = await db
    .select({
      id: dependencies.id,
      project_id: dependencies.project_id,
      package_id: dependencies.package_id,
      current_version: dependencies.current_version,
      version_range: dependencies.version_range,
      is_direct: dependencies.is_direct,
      is_dev: dependencies.is_dev,
      created_at: dependencies.created_at,
      package_name: packages.name,
      ecosystem: packages.ecosystem,
      reputation_tier: packages.reputation_tier,
      weekly_downloads: packages.weekly_downloads,
      is_deprecated: packages.is_deprecated,
      is_archived: packages.is_archived,
      typosquat_suspect: packages.typosquat_suspect,
      repo_url: packages.repo_url,
    })
    .from(dependencies)
    .leftJoin(packages, eq(dependencies.package_id, packages.id))
    .where(eq(dependencies.project_id, id))
    .orderBy(desc(dependencies.is_direct), packages.name)
  return c.json(rows)
})

// GET /:id/summary — public — risk posture summary for project
router.get('/:id/summary', async (c) => {
  const id = c.req.param('id')
  const [proj] = await db.select().from(projects).where(eq(projects.id, id))
  if (!proj) return c.json({ error: 'Not found' }, 404)

  const deps = await db.select().from(dependencies).where(eq(dependencies.project_id, id))

  // All updates for this project, with their grade (if scored).
  const projUpdates = await db
    .select({
      id: updates.id,
      status: updates.status,
      grade: risk_scores.grade,
      total_score: risk_scores.total_score,
    })
    .from(updates)
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(eq(updates.project_id, id))

  const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0, ungraded: 0 }
  const statusCounts: Record<string, number> = {}
  let scored = 0
  let scoreSum = 0
  let worstGrade = 'A'
  const gradeOrder = ['A', 'B', 'C', 'D', 'F']

  for (const u of projUpdates) {
    const g = u.grade ?? 'ungraded'
    grades[g] = (grades[g] ?? 0) + 1
    statusCounts[u.status] = (statusCounts[u.status] ?? 0) + 1
    if (u.grade) {
      if (gradeOrder.indexOf(u.grade) > gradeOrder.indexOf(worstGrade)) worstGrade = u.grade
    }
    if (typeof u.total_score === 'number') {
      scored++
      scoreSum += u.total_score
    }
  }

  const deprecatedPkgIds = deps.map((d) => d.package_id)
  let deprecatedCount = 0
  let typosquatCount = 0
  if (deprecatedPkgIds.length > 0) {
    const pkgRows = await db
      .select()
      .from(packages)
      .where(inArray(packages.id, deprecatedPkgIds))
    deprecatedCount = pkgRows.filter((p) => p.is_deprecated || p.is_archived).length
    typosquatCount = pkgRows.filter((p) => p.typosquat_suspect).length
  }

  return c.json({
    project_id: id,
    counts: {
      dependencies: deps.length,
      direct: deps.filter((d) => d.is_direct).length,
      dev: deps.filter((d) => d.is_dev).length,
      updates: projUpdates.length,
      pending: statusCounts['pending'] ?? 0,
      deprecated_packages: deprecatedCount,
      typosquat_suspects: typosquatCount,
    },
    grades,
    status: statusCounts,
    worst_grade: projUpdates.some((u) => u.grade) ? worstGrade : null,
    avg_score: scored > 0 ? Math.round((scoreSum / scored) * 100) / 100 : null,
  })
})

export default router
