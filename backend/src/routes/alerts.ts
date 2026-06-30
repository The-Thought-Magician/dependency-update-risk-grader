import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { alerts, workspaces, workspace_members } from '../db/schema.js'
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

// Public: list fired alerts for a workspace (newest first).
router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { workspace_id } = c.req.valid('query')
  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, workspace_id))
    .orderBy(desc(alerts.created_at))
  return c.json(rows)
})

// Auth: mark an alert resolved (workspace membership required).
router.post('/:id/resolve', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await userInWorkspace(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [updated] = await db
    .update(alerts)
    .set({ is_resolved: true })
    .where(eq(alerts.id, id))
    .returning()
  return c.json(updated)
})

export default router
