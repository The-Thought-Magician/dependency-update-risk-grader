import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { webhooks, webhook_deliveries, workspaces, workspace_members } from '../db/schema.js'
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

const EVENT_TYPES = [
  'update.created',
  'update.graded',
  'update.decision',
  'update.auto_cleared',
  'alert.raised',
  'policy.violation',
] as const

const webhookSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  event_types: z.array(z.string()).optional().default([]),
  secret: z.string().optional(),
  enabled: z.boolean().optional().default(true),
})

// ----------------------------------------------------------------------------
// GET / — list webhooks for a workspace (public read).
// ----------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspace_id, workspaceId))
    .orderBy(desc(webhooks.created_at))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// POST / — create a webhook (auth + ownership).
// ----------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', webhookSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isWorkspaceMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [created] = await db
    .insert(webhooks)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      url: body.url,
      event_types: body.event_types,
      secret: body.secret ?? null,
      enabled: body.enabled,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ----------------------------------------------------------------------------
// PUT /:id — update a webhook (auth + ownership).
// ----------------------------------------------------------------------------
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', webhookSchema.partial().omit({ workspace_id: true })),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (!(await isWorkspaceMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.url !== undefined) patch.url = body.url
    if (body.event_types !== undefined) patch.event_types = body.event_types
    if (body.secret !== undefined) patch.secret = body.secret
    if (body.enabled !== undefined) patch.enabled = body.enabled

    const [updated] = await db.update(webhooks).set(patch).where(eq(webhooks.id, id)).returning()
    return c.json(updated)
  },
)

// ----------------------------------------------------------------------------
// DELETE /:id — delete a webhook + its deliveries (auth + ownership).
// ----------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(webhook_deliveries).where(eq(webhook_deliveries.webhook_id, id))
  await db.delete(webhooks).where(eq(webhooks.id, id))
  return c.json({ success: true })
})

// ----------------------------------------------------------------------------
// GET /:id/deliveries — delivery log for a webhook (public read).
// ----------------------------------------------------------------------------
router.get('/:id/deliveries', async (c) => {
  const id = c.req.param('id')
  const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!wh) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(webhook_deliveries)
    .where(eq(webhook_deliveries.webhook_id, id))
    .orderBy(desc(webhook_deliveries.created_at))
    .limit(100)
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// POST /:id/test — send a test delivery and record a delivery row.
// Attempts a real outbound POST; records status/status_code regardless.
// ----------------------------------------------------------------------------
router.post('/:id/test', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [wh] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!wh) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(wh.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const eventType = 'webhook.test'
  const payload = {
    event: eventType,
    webhook_id: wh.id,
    workspace_id: wh.workspace_id,
    message: 'Test delivery from DependencyUpdateRiskGrader',
    sent_at: new Date().toISOString(),
  }

  let status = 'failed'
  let statusCode: number | null = null
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (wh.secret) headers['X-Webhook-Secret'] = wh.secret
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(wh.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timer)
    statusCode = res.status
    status = res.ok ? 'delivered' : 'failed'
  } catch {
    status = 'failed'
    statusCode = null
  }

  const [delivery] = await db
    .insert(webhook_deliveries)
    .values({
      webhook_id: wh.id,
      event_type: eventType,
      payload,
      status,
      status_code: statusCode,
      attempt: 1,
    })
    .returning()
  return c.json(delivery, 201)
})

export default router
