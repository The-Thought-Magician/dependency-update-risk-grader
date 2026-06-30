import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { policies, policy_rules, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Recognised rule types (see seeded defaults in index.ts).
const RULE_TYPES = [
  'block_new_install_hook', // block updates that introduce a new install/postinstall hook
  'block_new_maintainer', // block updates published by a brand-new maintainer
  'min_grade', // require updates to meet a minimum grade (threshold = grade letter)
  'max_score', // require total risk score below threshold (threshold = number)
  'block_remote_fetch', // block scripts that fetch remote resources
  'block_obfuscation', // block obfuscation-suspect scripts
  'block_unsigned', // block versions without provenance/signature
  'max_blast_radius', // require blast radius below threshold (threshold = number)
  'block_deprecated', // block deprecated/archived packages
  'block_typosquat', // block typosquat-suspect packages
] as const

const ruleSchema = z.object({
  policy_id: z.string().min(1),
  rule_type: z.enum(RULE_TYPES),
  threshold: z.string().nullable().optional(),
  action: z.enum(['block', 'needs_review', 'warn', 'allow']).optional().default('block'),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).optional().default({}),
})

// Confirm the acting user can administer the policy's workspace.
async function assertPolicyOwnership(policyId: string, userId: string) {
  const [policy] = await db.select().from(policies).where(eq(policies.id, policyId))
  if (!policy) return { ok: false as const, status: 404 as const, error: 'Policy not found' }
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, policy.workspace_id))
  if (!ws) return { ok: false as const, status: 404 as const, error: 'Workspace not found' }
  if (ws.owner_id === userId) return { ok: true as const, policy, ws }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, ws.id),
        eq(workspace_members.user_id, userId),
      ),
    )
  if (!member) return { ok: false as const, status: 403 as const, error: 'Forbidden' }
  return { ok: true as const, policy, ws }
}

// Public: list rules for a policy.
router.get('/', async (c) => {
  const policyId = c.req.query('policy_id')
  if (!policyId) return c.json({ error: 'policy_id is required' }, 400)
  const rules = await db
    .select()
    .from(policy_rules)
    .where(eq(policy_rules.policy_id, policyId))
    .orderBy(desc(policy_rules.created_at))
  return c.json(rules)
})

// Auth: add a rule to a policy.
router.post('/', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const own = await assertPolicyOwnership(body.policy_id, userId)
  if (!own.ok) return c.json({ error: own.error }, own.status)
  const [rule] = await db
    .insert(policy_rules)
    .values({
      policy_id: body.policy_id,
      rule_type: body.rule_type,
      threshold: body.threshold ?? null,
      action: body.action,
      enabled: body.enabled,
      config: body.config as Record<string, unknown>,
    })
    .returning()
  return c.json(rule, 201)
})

// Auth: update a rule.
router.put(
  '/:id',
  authMiddleware,
  zValidator(
    'json',
    z.object({
      rule_type: z.enum(RULE_TYPES).optional(),
      threshold: z.string().nullable().optional(),
      action: z.enum(['block', 'needs_review', 'warn', 'allow']).optional(),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(policy_rules).where(eq(policy_rules.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const own = await assertPolicyOwnership(existing.policy_id, userId)
    if (!own.ok) return c.json({ error: own.error }, own.status)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.rule_type !== undefined) patch.rule_type = body.rule_type
    if (body.threshold !== undefined) patch.threshold = body.threshold
    if (body.action !== undefined) patch.action = body.action
    if (body.enabled !== undefined) patch.enabled = body.enabled
    if (body.config !== undefined) patch.config = body.config
    if (Object.keys(patch).length === 0) return c.json(existing)
    const [updated] = await db
      .update(policy_rules)
      .set(patch)
      .where(eq(policy_rules.id, id))
      .returning()
    return c.json(updated)
  },
)

// Auth: delete a rule.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(policy_rules).where(eq(policy_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const own = await assertPolicyOwnership(existing.policy_id, userId)
  if (!own.ok) return c.json({ error: own.error }, own.status)
  await db.delete(policy_rules).where(eq(policy_rules.id, id))
  return c.json({ success: true })
})

export default router
