import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { alert_rules, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Helper: confirm the user owns or belongs to the workspace.
async function userInWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

const listQuerySchema = z.object({
  workspace_id: z.string().min(1),
})

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  trigger_type: z.string().min(1),
  threshold: z.string().optional().nullable(),
  channel: z.string().optional().default('in_app'),
  webhook_url: z.string().url().optional().nullable(),
  enabled: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  trigger_type: z.string().min(1).optional(),
  threshold: z.string().optional().nullable(),
  channel: z.string().optional(),
  webhook_url: z.string().url().optional().nullable(),
  enabled: z.boolean().optional(),
})

// Public: list alert rules for a workspace.
router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { workspace_id } = c.req.valid('query')
  const rows = await db
    .select()
    .from(alert_rules)
    .where(eq(alert_rules.workspace_id, workspace_id))
    .orderBy(desc(alert_rules.created_at))
  return c.json(rows)
})

// Auth: create an alert rule (workspace membership required).
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await userInWorkspace(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [created] = await db
    .insert(alert_rules)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      trigger_type: body.trigger_type,
      threshold: body.threshold ?? null,
      channel: body.channel ?? 'in_app',
      webhook_url: body.webhook_url ?? null,
      enabled: body.enabled ?? true,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update an alert rule.
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await userInWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const [updated] = await db
    .update(alert_rules)
    .set(body)
    .where(eq(alert_rules.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete an alert rule.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alert_rules).where(eq(alert_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await userInWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(alert_rules).where(eq(alert_rules.id, id))
  return c.json({ success: true })
})

export default router
