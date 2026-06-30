import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  updates,
  risk_scores,
  risk_factors,
  ledger_entries,
  workspaces,
  packages,
  projects,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Grade helpers
// ----------------------------------------------------------------------------

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'] as const
type Grade = (typeof GRADE_ORDER)[number]

// Lower index = safer grade. Returns -1 for unknown grades (sorts last).
function gradeIndex(grade: string | null | undefined): number {
  const i = GRADE_ORDER.indexOf((grade ?? '') as Grade)
  return i === -1 ? GRADE_ORDER.length : i
}

// "<= threshold" means grade is at least as safe as the threshold grade.
function gradeAtMostRisky(grade: string | null | undefined, threshold: string): boolean {
  const gi = gradeIndex(grade)
  const ti = gradeIndex(threshold)
  if (gi === GRADE_ORDER.length) return false
  return gi <= ti
}

// ----------------------------------------------------------------------------
// Ledger hash chain
// ----------------------------------------------------------------------------

async function lastEntryHash(workspaceId: string): Promise<string> {
  const [last] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.created_at))
    .limit(1)
  return last?.entry_hash ?? ''
}

function computeEntryHash(input: {
  prev_hash: string
  workspace_id: string
  update_id: string
  decision: string
  grade_at_decision: string
  score_at_decision: number
  actor_id: string
  justification: string
  created_at: string
}): string {
  const payload = [
    input.prev_hash,
    input.workspace_id,
    input.update_id,
    input.decision,
    input.grade_at_decision,
    String(input.score_at_decision),
    input.actor_id,
    input.justification,
    input.created_at,
  ].join('|')
  return createHash('sha256').update(payload).digest('hex')
}

// Append a decision to the per-workspace hash chain.
async function appendLedger(opts: {
  workspaceId: string
  updateId: string
  decision: string
  actorId: string
  justification: string
}): Promise<void> {
  const [score] = await db
    .select()
    .from(risk_scores)
    .where(eq(risk_scores.update_id, opts.updateId))
  const factors = await db
    .select()
    .from(risk_factors)
    .where(eq(risk_factors.update_id, opts.updateId))

  const prev_hash = await lastEntryHash(opts.workspaceId)
  const created = new Date()
  const created_at_iso = created.toISOString()
  const grade_at_decision = score?.grade ?? 'N/A'
  const score_at_decision = score?.total_score ?? 0

  const entry_hash = computeEntryHash({
    prev_hash,
    workspace_id: opts.workspaceId,
    update_id: opts.updateId,
    decision: opts.decision,
    grade_at_decision,
    score_at_decision,
    actor_id: opts.actorId,
    justification: opts.justification,
    created_at: created_at_iso,
  })

  await db.insert(ledger_entries).values({
    workspace_id: opts.workspaceId,
    update_id: opts.updateId,
    decision: opts.decision,
    grade_at_decision,
    score_at_decision,
    actor_id: opts.actorId,
    justification: opts.justification,
    policy_result: {},
    factors_snapshot: {
      factors: factors.map((f) => ({
        factor_type: f.factor_type,
        raw_value: f.raw_value,
        sub_score: f.sub_score,
        weight: f.weight,
        contribution: f.contribution,
      })),
    },
    prev_hash,
    entry_hash,
    created_at: created,
  })
}

// Map a transition action to the persisted update status + ledger decision verb.
const TRANSITION_STATUS: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  needs_review: 'needs_review',
  block: 'blocked',
  reset: 'pending',
}

// ----------------------------------------------------------------------------
// GET / — triage board grouped by status, ranked by grade (riskiest first).
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select({
      update: updates,
      score: risk_scores,
      pkg: packages,
      project: projects,
    })
    .from(updates)
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .leftJoin(packages, eq(packages.id, updates.package_id))
    .leftJoin(projects, eq(projects.id, updates.project_id))
    .where(eq(updates.workspace_id, workspaceId))

  const STATUSES = ['pending', 'needs_review', 'approved', 'rejected', 'blocked']
  const columns: Record<string, unknown[]> = {}
  for (const s of STATUSES) columns[s] = []

  const enriched = rows.map((r) => ({
    ...r.update,
    grade: r.score?.grade ?? null,
    total_score: r.score?.total_score ?? null,
    confidence: r.score?.confidence ?? null,
    package_name: r.pkg?.name ?? null,
    project_name: r.project?.name ?? null,
  }))

  // Riskiest first (worst grade, then highest score).
  enriched.sort((a, b) => {
    const gi = gradeIndex(b.grade) - gradeIndex(a.grade)
    if (gi !== 0) return gi
    return (b.total_score ?? 0) - (a.total_score ?? 0)
  })

  for (const u of enriched) {
    const col = columns[u.status] ?? (columns[u.status] = [])
    col.push(u)
  }

  return c.json({ columns })
})

// ----------------------------------------------------------------------------
// POST /:updateId/transition — change status + write ledger entry.
// ----------------------------------------------------------------------------

const transitionSchema = z.object({
  action: z.enum(['approve', 'reject', 'needs_review', 'block', 'reset']),
  justification: z.string().optional().default(''),
})

router.post(
  '/:updateId/transition',
  authMiddleware,
  zValidator('json', transitionSchema),
  async (c) => {
    const userId = getUserId(c)
    const updateId = c.req.param('updateId')
    const { action, justification } = c.req.valid('json')

    const [update] = await db.select().from(updates).where(eq(updates.id, updateId))
    if (!update) return c.json({ error: 'Update not found' }, 404)

    // Ownership: must be a member/owner of the workspace.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, update.workspace_id))
    if (!ws) return c.json({ error: 'Workspace not found' }, 404)

    const newStatus = TRANSITION_STATUS[action]
    const [updated] = await db
      .update(updates)
      .set({ status: newStatus, updated_at: new Date() })
      .where(eq(updates.id, updateId))
      .returning()

    await appendLedger({
      workspaceId: update.workspace_id,
      updateId,
      decision: action,
      actorId: userId,
      justification,
    })

    return c.json(updated)
  },
)

// ----------------------------------------------------------------------------
// POST /bulk — bulk status transition across many updates.
// ----------------------------------------------------------------------------

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1),
  action: z.enum(['approve', 'reject', 'needs_review', 'block', 'reset']),
  justification: z.string().optional().default(''),
})

router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const { ids, action, justification } = c.req.valid('json')
  const newStatus = TRANSITION_STATUS[action]

  let updatedCount = 0
  for (const id of ids) {
    const [update] = await db.select().from(updates).where(eq(updates.id, id))
    if (!update) continue
    await db
      .update(updates)
      .set({ status: newStatus, updated_at: new Date() })
      .where(eq(updates.id, id))
    await appendLedger({
      workspaceId: update.workspace_id,
      updateId: id,
      decision: action,
      actorId: userId,
      justification,
    })
    updatedCount++
  }

  return c.json({ updated: updatedCount })
})

// ----------------------------------------------------------------------------
// POST /auto-clear — auto-approve all pending updates whose grade is at or
// below the workspace auto_clear_max_grade threshold.
// ----------------------------------------------------------------------------

router.post('/auto-clear', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const threshold = ws.auto_clear_max_grade

  const rows = await db
    .select({ update: updates, score: risk_scores })
    .from(updates)
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(and(eq(updates.workspace_id, workspaceId), eq(updates.status, 'pending')))

  let cleared = 0
  for (const r of rows) {
    if (!gradeAtMostRisky(r.score?.grade, threshold)) continue
    await db
      .update(updates)
      .set({ status: 'approved', updated_at: new Date() })
      .where(eq(updates.id, r.update.id))
    await appendLedger({
      workspaceId,
      updateId: r.update.id,
      decision: 'auto_clear',
      actorId: userId,
      justification: `Auto-cleared: grade ${r.score?.grade ?? 'N/A'} <= threshold ${threshold}`,
    })
    cleared++
  }

  return c.json({ cleared })
})

// ----------------------------------------------------------------------------
// POST /:updateId/assign — assign a reviewer to an update.
// ----------------------------------------------------------------------------

const assignSchema = z.object({
  assigned_to: z.string().nullable(),
})

router.post(
  '/:updateId/assign',
  authMiddleware,
  zValidator('json', assignSchema),
  async (c) => {
    const updateId = c.req.param('updateId')
    const { assigned_to } = c.req.valid('json')

    const [update] = await db.select().from(updates).where(eq(updates.id, updateId))
    if (!update) return c.json({ error: 'Update not found' }, 404)

    const [updated] = await db
      .update(updates)
      .set({ assigned_to, updated_at: new Date() })
      .where(eq(updates.id, updateId))
      .returning()

    return c.json(updated)
  },
)

export default router
