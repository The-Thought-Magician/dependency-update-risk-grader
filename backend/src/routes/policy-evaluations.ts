import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  policies,
  policy_rules,
  policy_evaluations,
  updates,
  risk_scores,
  script_diffs,
  dependency_deltas,
  packages,
  package_versions,
  package_maintainers,
  maintainers,
  workspaces,
  workspace_members,
} from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Grade ordering, best -> worst. Lower index == safer.
const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F']

function gradeRank(grade: string): number {
  const idx = GRADE_ORDER.indexOf(grade.toUpperCase())
  return idx === -1 ? GRADE_ORDER.length : idx
}

// True when `grade` is at least as good as `min` (e.g. min_grade 'C' -> A,B,C pass).
function meetsMinGrade(grade: string, min: string): boolean {
  return gradeRank(grade) <= gradeRank(min)
}

interface RuleResult {
  rule_type: string
  passed: boolean
  message: string
}

// Evaluate a single rule against the gathered facts for an update.
function evaluateRule(
  rule: typeof policy_rules.$inferSelect,
  facts: {
    grade: string | null
    score: number | null
    diff: typeof script_diffs.$inferSelect | undefined
    delta: typeof dependency_deltas.$inferSelect | undefined
    pkg: typeof packages.$inferSelect | undefined
    newMaintainer: boolean
    unsigned: boolean
  },
): RuleResult {
  const { rule_type, threshold } = rule
  switch (rule_type) {
    case 'block_new_install_hook': {
      const bad = facts.diff?.has_new_install_hook === true
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'Update introduces a new install/postinstall lifecycle hook.'
          : 'No new install hooks detected.',
      }
    }
    case 'block_new_maintainer': {
      const bad = facts.newMaintainer
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'Update was published by a maintainer flagged as new/low-trust.'
          : 'No new-maintainer signal on the target version.',
      }
    }
    case 'min_grade': {
      const min = (threshold ?? 'C').toUpperCase()
      if (facts.grade == null)
        return { rule_type, passed: false, message: `No grade computed; required >= ${min}.` }
      const ok = meetsMinGrade(facts.grade, min)
      return {
        rule_type,
        passed: ok,
        message: ok
          ? `Grade ${facts.grade} meets minimum ${min}.`
          : `Grade ${facts.grade} is below required minimum ${min}.`,
      }
    }
    case 'max_score': {
      const limit = threshold != null ? Number(threshold) : 60
      if (facts.score == null)
        return { rule_type, passed: false, message: `No score computed; required <= ${limit}.` }
      const ok = facts.score <= limit
      return {
        rule_type,
        passed: ok,
        message: ok
          ? `Risk score ${facts.score.toFixed(1)} is within limit ${limit}.`
          : `Risk score ${facts.score.toFixed(1)} exceeds limit ${limit}.`,
      }
    }
    case 'block_remote_fetch': {
      const bad = facts.diff?.fetches_remote === true
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'A lifecycle script in this update fetches a remote resource.'
          : 'No remote-fetching scripts detected.',
      }
    }
    case 'block_obfuscation': {
      const bad = facts.diff?.obfuscation_suspect === true
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'A lifecycle script in this update is obfuscation-suspect.'
          : 'No obfuscated scripts detected.',
      }
    }
    case 'block_unsigned': {
      const bad = facts.unsigned
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'Target version lacks provenance/signature attestation.'
          : 'Target version is signed / has provenance.',
      }
    }
    case 'max_blast_radius': {
      const limit = threshold != null ? Number(threshold) : 25
      const radius = facts.delta?.blast_radius ?? 0
      const ok = radius <= limit
      return {
        rule_type,
        passed: ok,
        message: ok
          ? `Blast radius ${radius} is within limit ${limit}.`
          : `Blast radius ${radius} exceeds limit ${limit}.`,
      }
    }
    case 'block_deprecated': {
      const bad = facts.pkg?.is_deprecated === true || facts.pkg?.is_archived === true
      return {
        rule_type,
        passed: !bad,
        message: bad
          ? 'Package is deprecated or archived.'
          : 'Package is neither deprecated nor archived.',
      }
    }
    case 'block_typosquat': {
      const bad = facts.pkg?.typosquat_suspect === true
      return {
        rule_type,
        passed: !bad,
        message: bad ? 'Package is flagged as a typosquat suspect.' : 'No typosquat signal.',
      }
    }
    default:
      return { rule_type, passed: true, message: `Unknown rule type "${rule_type}"; skipped.` }
  }
}

// Gather every fact a rule could need for one update.
async function gatherFacts(update: typeof updates.$inferSelect) {
  const [score] = await db.select().from(risk_scores).where(eq(risk_scores.update_id, update.id))
  const [diff] = await db.select().from(script_diffs).where(eq(script_diffs.update_id, update.id))
  const [delta] = await db
    .select()
    .from(dependency_deltas)
    .where(eq(dependency_deltas.update_id, update.id))
  const [pkg] = await db.select().from(packages).where(eq(packages.id, update.package_id))

  // Resolve the target version + its publisher to derive maintainer/signing signals.
  let newMaintainer = false
  let unsigned = false
  const [targetVersion] = await db
    .select()
    .from(package_versions)
    .where(
      and(
        eq(package_versions.package_id, update.package_id),
        eq(package_versions.version, update.to_version),
      ),
    )
  if (targetVersion) {
    unsigned = !targetVersion.has_provenance && !targetVersion.signature_present
    const links = await db
      .select()
      .from(package_maintainers)
      .where(eq(package_maintainers.package_version_id, targetVersion.id))
    for (const link of links) {
      const [m] = await db.select().from(maintainers).where(eq(maintainers.id, link.maintainer_id))
      if (!m) continue
      const created = m.account_created_at ? new Date(m.account_created_at).getTime() : 0
      const ageDays = created ? (Date.now() - created) / 86_400_000 : Infinity
      // New/low-trust publisher heuristic.
      if (m.trust_score < 30 || ageDays < 90 || m.reputation === 'new') newMaintainer = true
    }
  }

  return {
    grade: score?.grade ?? null,
    score: score?.total_score ?? null,
    diff,
    delta,
    pkg,
    newMaintainer,
    unsigned,
  }
}

// Public: latest rule pass/fail results for an update.
router.get('/:updateId', async (c) => {
  const updateId = c.req.param('updateId')
  const rows = await db
    .select()
    .from(policy_evaluations)
    .where(eq(policy_evaluations.update_id, updateId))
    .orderBy(asc(policy_evaluations.created_at))
  return c.json(rows)
})

// Auth: evaluate an update against its workspace's default policy.
router.post('/:updateId/run', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const updateId = c.req.param('updateId')

  const [update] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!update) return c.json({ error: 'Update not found' }, 404)

  // Ownership: owner or workspace member.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, update.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) {
    const [member] = await db
      .select()
      .from(workspace_members)
      .where(
        and(
          eq(workspace_members.workspace_id, ws.id),
          eq(workspace_members.user_id, userId),
        ),
      )
    if (!member) return c.json({ error: 'Forbidden' }, 403)
  }

  // Resolve the workspace default policy.
  let policy: typeof policies.$inferSelect | undefined
  if (ws.default_policy_id) {
    ;[policy] = await db.select().from(policies).where(eq(policies.id, ws.default_policy_id))
  }
  if (!policy) {
    ;[policy] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.workspace_id, ws.id), eq(policies.is_default, true)))
  }
  if (!policy) return c.json({ error: 'No default policy configured for workspace' }, 400)

  const rules = await db
    .select()
    .from(policy_rules)
    .where(and(eq(policy_rules.policy_id, policy.id), eq(policy_rules.enabled, true)))

  const facts = await gatherFacts(update)

  // Recompute fresh results.
  await db.delete(policy_evaluations).where(eq(policy_evaluations.update_id, updateId))

  const inserted: Array<typeof policy_evaluations.$inferSelect> = []
  for (const rule of rules) {
    const res = evaluateRule(rule, facts)
    const [row] = await db
      .insert(policy_evaluations)
      .values({
        update_id: updateId,
        policy_id: policy.id,
        rule_type: res.rule_type,
        passed: res.passed,
        message: res.message,
      })
      .returning()
    inserted.push(row)
  }

  return c.json(inserted)
})

export default router
