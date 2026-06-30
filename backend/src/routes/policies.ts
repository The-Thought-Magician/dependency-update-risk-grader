import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  policies,
  policy_rules,
  workspaces,
  updates,
  risk_scores,
  risk_factors,
  packages,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Grade band helpers
// ----------------------------------------------------------------------------

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'] as const

const DEFAULT_WEIGHTS: Record<string, number> = {
  maintainer_change: 0.2,
  install_scripts: 0.2,
  publish_cadence: 0.1,
  provenance: 0.15,
  blast_radius: 0.15,
  version_jump: 0.1,
  reputation: 0.1,
}

const DEFAULT_BANDS: Record<string, number> = { A: 20, B: 40, C: 60, D: 80, F: 100 }

// Map a 0..100 score to a letter grade using ascending band ceilings.
function scoreToGrade(score: number, bands: Record<string, number>): string {
  const ordered = GRADE_ORDER.filter((g) => g in bands)
  for (const g of ordered) {
    if (score <= bands[g]) return g
  }
  return 'F'
}

// ----------------------------------------------------------------------------
// GET / — list policies for a workspace.
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(policies)
    .where(eq(policies.workspace_id, workspaceId))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — policy detail with its rules.
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [policy] = await db.select().from(policies).where(eq(policies.id, id))
  if (!policy) return c.json({ error: 'Policy not found' }, 404)
  const rules = await db.select().from(policy_rules).where(eq(policy_rules.policy_id, id))
  return c.json({ ...policy, rules })
})

// ----------------------------------------------------------------------------
// POST / — create a policy in a workspace (member-gated).
// ----------------------------------------------------------------------------

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  weights: z.record(z.string(), z.number()).optional(),
  grade_bands: z.record(z.string(), z.number()).optional(),
  auto_clear_max_grade: z.string().optional().default('B'),
  is_default: z.boolean().optional().default(false),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  // If this policy is flagged default, clear the flag on the others first.
  if (body.is_default) {
    await db
      .update(policies)
      .set({ is_default: false })
      .where(eq(policies.workspace_id, body.workspace_id))
  }

  const [created] = await db
    .insert(policies)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      description: body.description,
      weights: body.weights ?? DEFAULT_WEIGHTS,
      grade_bands: body.grade_bands ?? DEFAULT_BANDS,
      auto_clear_max_grade: body.auto_clear_max_grade,
      is_default: body.is_default,
      created_by: userId,
    })
    .returning()

  if (body.is_default) {
    await db
      .update(workspaces)
      .set({ default_policy_id: created.id })
      .where(eq(workspaces.id, body.workspace_id))
  }

  return c.json(created, 201)
})

// ----------------------------------------------------------------------------
// PUT /:id — update weights / bands / auto-clear / metadata.
// ----------------------------------------------------------------------------

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  weights: z.record(z.string(), z.number()).optional(),
  grade_bands: z.record(z.string(), z.number()).optional(),
  auto_clear_max_grade: z.string().optional(),
  is_default: z.boolean().optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(policies).where(eq(policies.id, id))
  if (!existing) return c.json({ error: 'Policy not found' }, 404)

  if (body.is_default === true) {
    await db
      .update(policies)
      .set({ is_default: false })
      .where(eq(policies.workspace_id, existing.workspace_id))
  }

  const [updated] = await db
    .update(policies)
    .set({ ...body, updated_at: new Date() })
    .where(eq(policies.id, id))
    .returning()

  if (body.is_default === true) {
    await db
      .update(workspaces)
      .set({ default_policy_id: id })
      .where(eq(workspaces.id, existing.workspace_id))
  }

  return c.json(updated)
})

// ----------------------------------------------------------------------------
// DELETE /:id — delete a policy (and its rules).
// ----------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(policies).where(eq(policies.id, id))
  if (!existing) return c.json({ error: 'Policy not found' }, 404)
  if (existing.is_default) {
    return c.json({ error: 'Cannot delete the default policy' }, 400)
  }
  await db.delete(policy_rules).where(eq(policy_rules.policy_id, id))
  await db.delete(policies).where(eq(policies.id, id))
  return c.json({ success: true })
})

// ----------------------------------------------------------------------------
// POST /:id/simulate — dry-run this policy over historical updates and report
// how each update's grade would change under the policy's weights & bands.
// ----------------------------------------------------------------------------

router.post('/:id/simulate', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const [policy] = await db.select().from(policies).where(eq(policies.id, id))
  if (!policy) return c.json({ error: 'Policy not found' }, 404)

  const weights = (policy.weights ?? DEFAULT_WEIGHTS) as Record<string, number>
  const bands = (policy.grade_bands ?? DEFAULT_BANDS) as Record<string, number>

  // All updates in this policy's workspace.
  const wsUpdates = await db
    .select({ update: updates, score: risk_scores, pkg: packages })
    .from(updates)
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .leftJoin(packages, eq(packages.id, updates.package_id))
    .where(eq(updates.workspace_id, policy.workspace_id))

  const results = []
  let changed = 0
  let worsened = 0
  let improved = 0

  for (const row of wsUpdates) {
    const factors = await db
      .select()
      .from(risk_factors)
      .where(eq(risk_factors.update_id, row.update.id))

    // Recompute total: weighted sum of each factor's sub_score using policy
    // weights, normalized to 0..100. sub_score is assumed 0..100 per factor.
    let weightedSum = 0
    let weightTotal = 0
    for (const f of factors) {
      const w = weights[f.factor_type] ?? 0
      weightedSum += w * f.sub_score
      weightTotal += w
    }
    const simulatedScore = weightTotal > 0 ? weightedSum / weightTotal : 0
    const simulatedGrade = scoreToGrade(simulatedScore, bands)

    const currentGrade = row.score?.grade ?? null
    const currentScore = row.score?.total_score ?? null

    const didChange = currentGrade !== null && currentGrade !== simulatedGrade
    if (didChange) {
      changed++
      const ci = GRADE_ORDER.indexOf(currentGrade as (typeof GRADE_ORDER)[number])
      const si = GRADE_ORDER.indexOf(simulatedGrade as (typeof GRADE_ORDER)[number])
      if (si > ci) worsened++
      else if (si < ci) improved++
    }

    results.push({
      update_id: row.update.id,
      package_name: row.pkg?.name ?? null,
      from_version: row.update.from_version,
      to_version: row.update.to_version,
      current_grade: currentGrade,
      current_score: currentScore,
      simulated_grade: simulatedGrade,
      simulated_score: Math.round(simulatedScore * 100) / 100,
      changed: didChange,
    })
  }

  return c.json({
    policy_id: id,
    weights,
    grade_bands: bands,
    total: results.length,
    changed,
    worsened,
    improved,
    results,
  })
})

export default router
