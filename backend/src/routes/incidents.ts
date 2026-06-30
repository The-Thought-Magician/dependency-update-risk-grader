import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  incidents,
  workspaces,
  workspace_members,
  projects,
  packages,
  updates,
  risk_factors,
  risk_scores,
  policies,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import {
  FACTOR_TYPES,
  DEFAULT_WEIGHTS,
  DEFAULT_GRADE_BANDS,
  gradeForScore,
  type FactorType,
} from './rules.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Helpers
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

// Build per-factor sub-scores (0..100, higher == riskier) from an incident.
// Use explicit details.factors when present; otherwise derive a malicious-update
// profile anchored on the incident's catching_factor so the replay reproduces
// the kind of signal that originally caught it.
function factorsForIncident(incident: typeof incidents.$inferSelect): Record<FactorType, number> {
  const details = (incident.details ?? {}) as Record<string, unknown>
  const supplied = (details.factors ?? {}) as Record<string, unknown>

  // Baseline: a benign-ish profile, then escalate the catching factor + correlates.
  const base: Record<FactorType, number> = {
    maintainer_trust: 30,
    version_cadence: 25,
    provenance: 30,
    install_scripts: 20,
    dependency_blast_radius: 25,
    package_reputation: 25,
    bump_magnitude: 30,
    publisher_2fa: 25,
  }

  // Map the documented catching factor to the factor(s) it should light up.
  const catching = (incident.catching_factor ?? '').toLowerCase()
  const bump = (() => {
    const escalate = (key: FactorType, value: number) => {
      base[key] = Math.max(base[key], value)
    }
    if (catching.includes('install') || catching.includes('script') || catching.includes('hook')) {
      escalate('install_scripts', 95)
      escalate('provenance', 70)
    }
    if (catching.includes('maintainer') || catching.includes('takeover') || catching.includes('account')) {
      escalate('maintainer_trust', 95)
      escalate('publisher_2fa', 80)
    }
    if (catching.includes('provenance') || catching.includes('signature') || catching.includes('tarball')) {
      escalate('provenance', 95)
    }
    if (catching.includes('typosquat') || catching.includes('reputation') || catching.includes('deprecat')) {
      escalate('package_reputation', 95)
    }
    if (catching.includes('cadence') || catching.includes('timing') || catching.includes('publish')) {
      escalate('version_cadence', 90)
    }
    if (catching.includes('dependency') || catching.includes('transitive') || catching.includes('blast')) {
      escalate('dependency_blast_radius', 90)
    }
    if (catching.includes('2fa') || catching.includes('mfa')) {
      escalate('publisher_2fa', 95)
    }
    if (catching.includes('major') || catching.includes('bump') || catching.includes('version')) {
      escalate('bump_magnitude', 85)
    }
  })()
  void bump

  const out: Record<FactorType, number> = { ...base }
  for (const f of FACTOR_TYPES) {
    const v = supplied[f]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[f] = Math.max(0, Math.min(100, v))
    }
  }
  return out
}

function scoreFactors(
  subs: Record<FactorType, number>,
  weights: Record<string, number>,
  bands: Record<string, number>,
) {
  let weighted = 0
  let weightSum = 0
  const breakdown: Array<{
    factor: string
    raw: number
    sub_score: number
    weight: number
    contribution: number
  }> = []
  for (const f of FACTOR_TYPES) {
    const w = typeof weights[f] === 'number' ? weights[f] : DEFAULT_WEIGHTS[f]
    const sub = subs[f]
    const contribution = sub * w
    weighted += contribution
    weightSum += w
    breakdown.push({ factor: f, raw: sub, sub_score: sub, weight: w, contribution })
  }
  const total = weightSum > 0 ? weighted / weightSum : 0
  const total_score = Math.round(total * 100) / 100
  return { total_score, grade: gradeForScore(total, bands), breakdown }
}

// ----------------------------------------------------------------------------
// GET / — list known-incident replays
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const all = await db.select().from(incidents).orderBy(desc(incidents.year))
  return c.json(all)
})

// ----------------------------------------------------------------------------
// GET /:id — incident detail (accepts id or slug)
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  let [inc] = await db.select().from(incidents).where(eq(incidents.id, id))
  if (!inc) {
    ;[inc] = await db.select().from(incidents).where(eq(incidents.slug, id))
  }
  if (!inc) return c.json({ error: 'Not found' }, 404)
  return c.json(inc)
})

// ----------------------------------------------------------------------------
// POST /:id/replay — create a graded update from the incident in a workspace
// ----------------------------------------------------------------------------

const replaySchema = z.object({
  workspace_id: z.string().min(1),
  project_id: z.string().optional(),
})

router.post('/:id/replay', authMiddleware, zValidator('json', replaySchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { workspace_id, project_id } = c.req.valid('json')

  if (!(await assertMember(workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let [inc] = await db.select().from(incidents).where(eq(incidents.id, id))
  if (!inc) {
    ;[inc] = await db.select().from(incidents).where(eq(incidents.slug, id))
  }
  if (!inc) return c.json({ error: 'Incident not found' }, 404)

  // Resolve or create the package referenced by the incident.
  let [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.name, inc.package_name), eq(packages.ecosystem, inc.ecosystem)))
  if (!pkg) {
    ;[pkg] = await db
      .insert(packages)
      .values({
        name: inc.package_name,
        ecosystem: inc.ecosystem,
        reputation_tier: 'niche',
      })
      .returning()
  }

  // Resolve target project: caller-provided (must belong to workspace) or a
  // dedicated "Incident Replays" project for this workspace.
  let project
  if (project_id) {
    ;[project] = await db.select().from(projects).where(eq(projects.id, project_id))
    if (!project || project.workspace_id !== workspace_id) {
      return c.json({ error: 'Project not found in workspace' }, 404)
    }
  } else {
    ;[project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspace_id, workspace_id), eq(projects.name, 'Incident Replays')))
    if (!project) {
      ;[project] = await db
        .insert(projects)
        .values({
          workspace_id,
          name: 'Incident Replays',
          ecosystem: inc.ecosystem,
          tags: ['incident-replay'],
          created_by: userId,
        })
        .returning()
    }
  }

  // Determine bump_type from version strings (best-effort semver-ish).
  const bumpType = (() => {
    const fp = inc.from_version.replace(/^[^\d]*/, '').split('.')
    const tp = inc.to_version.replace(/^[^\d]*/, '').split('.')
    if (fp[0] !== tp[0]) return 'major'
    if (fp[1] !== tp[1]) return 'minor'
    return 'patch'
  })()

  // Create the update row.
  const [update] = await db
    .insert(updates)
    .values({
      workspace_id,
      project_id: project.id,
      package_id: pkg.id,
      from_version: inc.from_version,
      to_version: inc.to_version,
      ecosystem: inc.ecosystem,
      bump_type: bumpType,
      source: 'incident_replay',
      source_pr_url: null,
      status: 'pending',
      created_by: userId,
    })
    .returning()

  // Grade it using the workspace default policy (or built-in defaults).
  const policy = await getDefaultPolicy(workspace_id)
  const weights =
    policy && policy.weights && Object.keys(policy.weights).length
      ? (policy.weights as Record<string, number>)
      : DEFAULT_WEIGHTS
  const bands =
    policy && policy.grade_bands && Object.keys(policy.grade_bands).length
      ? (policy.grade_bands as Record<string, number>)
      : DEFAULT_GRADE_BANDS

  const subs = factorsForIncident(inc)
  const { total_score, grade, breakdown } = scoreFactors(subs, weights, bands)

  // Persist per-factor rows.
  for (const b of breakdown) {
    await db
      .insert(risk_factors)
      .values({
        update_id: update.id,
        factor_type: b.factor,
        raw_value: b.raw,
        sub_score: b.sub_score,
        weight: b.weight,
        contribution: b.contribution,
        detail: { source: 'incident_replay', incident_slug: inc.slug },
      })
      .onConflictDoUpdate({
        target: [risk_factors.update_id, risk_factors.factor_type],
        set: {
          raw_value: b.raw,
          sub_score: b.sub_score,
          weight: b.weight,
          contribution: b.contribution,
        },
      })
  }

  // Persist the aggregate risk score.
  const [score] = await db
    .insert(risk_scores)
    .values({
      update_id: update.id,
      total_score,
      grade,
      confidence: 1,
      breakdown,
    })
    .onConflictDoUpdate({
      target: risk_scores.update_id,
      set: { total_score, grade, breakdown, computed_at: new Date() },
    })
    .returning()

  return c.json(
    {
      update,
      score,
      factors: breakdown,
      incident: {
        id: inc.id,
        slug: inc.slug,
        name: inc.name,
        catching_factor: inc.catching_factor,
        expected_grade: inc.expected_grade,
        actual_grade: grade,
        matched_expected: grade === inc.expected_grade,
      },
    },
    201,
  )
})

export default router
