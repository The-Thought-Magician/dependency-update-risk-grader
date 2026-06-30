import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  policies,
  updates,
  risk_factors,
  risk_scores,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Default risk model. Weights sum to 1.0 across the canonical factor set.
// grade_bands map a grade letter -> the MINIMUM total_score (0..100) needed
// to earn that grade. Higher score == riskier. A lower (better) letter is
// awarded when the score stays below the next band's floor.
// ----------------------------------------------------------------------------

export const FACTOR_TYPES = [
  'maintainer_trust',
  'version_cadence',
  'provenance',
  'install_scripts',
  'dependency_blast_radius',
  'package_reputation',
  'bump_magnitude',
  'publisher_2fa',
] as const

export type FactorType = (typeof FACTOR_TYPES)[number]

export const DEFAULT_WEIGHTS: Record<FactorType, number> = {
  maintainer_trust: 0.2,
  version_cadence: 0.12,
  provenance: 0.16,
  install_scripts: 0.18,
  dependency_blast_radius: 0.1,
  package_reputation: 0.1,
  bump_magnitude: 0.08,
  publisher_2fa: 0.06,
}

// Grade floors on a 0..100 risk scale (higher == worse).
export const DEFAULT_GRADE_BANDS: Record<string, number> = {
  A: 0,
  B: 20,
  C: 40,
  D: 60,
  F: 80,
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']

export function gradeForScore(score: number, bands: Record<string, number>): string {
  // Pick the highest-floor band whose floor the score meets or exceeds.
  let grade = 'A'
  let best = -Infinity
  for (const [g, floor] of Object.entries(bands)) {
    if (score >= floor && floor >= best) {
      best = floor
      grade = g
    }
  }
  return grade
}

function gradeRank(grade: string): number {
  const i = GRADE_ORDER.indexOf(grade)
  return i === -1 ? GRADE_ORDER.length : i
}

function normalizeWeights(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of FACTOR_TYPES) {
    const v = raw[f]
    out[f] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[f]
  }
  return out
}

function normalizeBands(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const g of GRADE_ORDER) {
    const v = raw[g]
    out[g] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_GRADE_BANDS[g]
  }
  return out
}

// ----------------------------------------------------------------------------
// Workspace + default policy helpers
// ----------------------------------------------------------------------------

async function assertMember(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

async function getDefaultPolicy(workspaceId: string) {
  const [byFlag] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.workspace_id, workspaceId), eq(policies.is_default, true)))
  if (byFlag) return byFlag
  const [any] = await db
    .select()
    .from(policies)
    .where(eq(policies.workspace_id, workspaceId))
    .orderBy(desc(policies.created_at))
  return any ?? null
}

// Recompute a total score for an update from its persisted risk_factors using a
// candidate weight map, then map to a grade with candidate bands. Deterministic.
function scoreFromFactors(
  factors: Array<{ factor_type: string; sub_score: number }>,
  weights: Record<string, number>,
  bands: Record<string, number>,
): { total_score: number; grade: string } {
  let weighted = 0
  let weightSum = 0
  for (const f of factors) {
    const w = weights[f.factor_type]
    if (typeof w !== 'number') continue
    const sub = Number.isFinite(f.sub_score) ? f.sub_score : 0
    weighted += sub * w
    weightSum += w
  }
  // sub_score is stored on a 0..100 scale; renormalize by the weight mass that
  // actually had matching factors so partial factor coverage still scales 0..100.
  const total = weightSum > 0 ? weighted / weightSum : 0
  return { total_score: Math.round(total * 100) / 100, grade: gradeForScore(total, bands) }
}

// ----------------------------------------------------------------------------
// GET / — current risk weights + grade bands from the workspace default policy
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const policy = await getDefaultPolicy(workspaceId)
  if (!policy) {
    return c.json({
      weights: DEFAULT_WEIGHTS,
      grade_bands: DEFAULT_GRADE_BANDS,
      auto_clear_max_grade: 'B',
      policy_id: null,
    })
  }
  const weights = normalizeWeights((policy.weights ?? {}) as Record<string, unknown>)
  const grade_bands = normalizeBands((policy.grade_bands ?? {}) as Record<string, unknown>)
  return c.json({
    weights,
    grade_bands,
    auto_clear_max_grade: policy.auto_clear_max_grade,
    policy_id: policy.id,
  })
})

// ----------------------------------------------------------------------------
// PUT / — update weights/bands/auto-clear on default policy + live re-score
// preview across that workspace's existing updates.
// ----------------------------------------------------------------------------

const putSchema = z.object({
  workspace_id: z.string().min(1),
  weights: z.record(z.string(), z.number().min(0)).optional(),
  grade_bands: z.record(z.string(), z.number().min(0)).optional(),
  auto_clear_max_grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
})

router.put('/', authMiddleware, zValidator('json', putSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await assertMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let policy = await getDefaultPolicy(body.workspace_id)
  if (!policy) {
    // Materialize a default policy so weights have somewhere to live.
    const [created] = await db
      .insert(policies)
      .values({
        workspace_id: body.workspace_id,
        name: 'Default Policy',
        description: 'Auto-created default risk policy',
        weights: DEFAULT_WEIGHTS,
        grade_bands: DEFAULT_GRADE_BANDS,
        auto_clear_max_grade: 'B',
        is_default: true,
        created_by: userId,
      })
      .returning()
    policy = created
    await db
      .update(workspaces)
      .set({ default_policy_id: created.id })
      .where(eq(workspaces.id, body.workspace_id))
  }

  const nextWeights = normalizeWeights({
    ...((policy.weights ?? {}) as Record<string, unknown>),
    ...(body.weights ?? {}),
  })
  const nextBands = normalizeBands({
    ...((policy.grade_bands ?? {}) as Record<string, unknown>),
    ...(body.grade_bands ?? {}),
  })
  const nextAutoClear = body.auto_clear_max_grade ?? policy.auto_clear_max_grade

  const [updatedPolicy] = await db
    .update(policies)
    .set({
      weights: nextWeights,
      grade_bands: nextBands,
      auto_clear_max_grade: nextAutoClear,
      updated_at: new Date(),
    })
    .where(eq(policies.id, policy.id))
    .returning()

  // Live re-score preview: recompute grade for each update in this workspace
  // from its persisted factors with the NEW weights/bands, compared to current.
  const workspaceUpdates = await db
    .select()
    .from(updates)
    .where(eq(updates.workspace_id, body.workspace_id))

  const preview: Array<{
    update_id: string
    from_version: string
    to_version: string
    current_grade: string | null
    current_score: number | null
    new_grade: string
    new_score: number
    changed: boolean
  }> = []

  let upgrades = 0
  let downgrades = 0
  for (const u of workspaceUpdates) {
    const factors = await db.select().from(risk_factors).where(eq(risk_factors.update_id, u.id))
    if (factors.length === 0) continue
    const [existingScore] = await db
      .select()
      .from(risk_scores)
      .where(eq(risk_scores.update_id, u.id))
    const { total_score, grade } = scoreFromFactors(
      factors.map((f) => ({ factor_type: f.factor_type, sub_score: f.sub_score })),
      nextWeights,
      nextBands,
    )
    const changed = !existingScore || existingScore.grade !== grade
    if (existingScore) {
      const delta = gradeRank(grade) - gradeRank(existingScore.grade)
      if (delta < 0) upgrades++
      else if (delta > 0) downgrades++
    }
    preview.push({
      update_id: u.id,
      from_version: u.from_version,
      to_version: u.to_version,
      current_grade: existingScore?.grade ?? null,
      current_score: existingScore?.total_score ?? null,
      new_grade: grade,
      new_score: total_score,
      changed,
    })
  }

  return c.json({
    weights: nextWeights,
    grade_bands: nextBands,
    auto_clear_max_grade: updatedPolicy.auto_clear_max_grade,
    policy_id: updatedPolicy.id,
    preview: {
      total: preview.length,
      changed: preview.filter((p) => p.changed).length,
      upgrades,
      downgrades,
      updates: preview,
    },
  })
})

// ----------------------------------------------------------------------------
// POST /reset — restore default weights/bands on the workspace default policy
// ----------------------------------------------------------------------------

const resetSchema = z.object({ workspace_id: z.string().min(1) })

router.post('/reset', authMiddleware, zValidator('json', resetSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await assertMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let policy = await getDefaultPolicy(workspace_id)
  if (!policy) {
    const [created] = await db
      .insert(policies)
      .values({
        workspace_id,
        name: 'Default Policy',
        description: 'Auto-created default risk policy',
        weights: DEFAULT_WEIGHTS,
        grade_bands: DEFAULT_GRADE_BANDS,
        auto_clear_max_grade: 'B',
        is_default: true,
        created_by: userId,
      })
      .returning()
    await db
      .update(workspaces)
      .set({ default_policy_id: created.id })
      .where(eq(workspaces.id, workspace_id))
    return c.json({
      weights: DEFAULT_WEIGHTS,
      grade_bands: DEFAULT_GRADE_BANDS,
      auto_clear_max_grade: created.auto_clear_max_grade,
      policy_id: created.id,
    })
  }

  const [updated] = await db
    .update(policies)
    .set({
      weights: DEFAULT_WEIGHTS,
      grade_bands: DEFAULT_GRADE_BANDS,
      auto_clear_max_grade: 'B',
      updated_at: new Date(),
    })
    .where(eq(policies.id, policy.id))
    .returning()

  return c.json({
    weights: DEFAULT_WEIGHTS,
    grade_bands: DEFAULT_GRADE_BANDS,
    auto_clear_max_grade: updated.auto_clear_max_grade,
    policy_id: updated.id,
  })
})

export default router
