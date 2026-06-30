import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspace_members, workspaces } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ROLES = ['owner', 'admin', 'reviewer', 'viewer'] as const

const addSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
  role: z.enum(ROLES).optional().default('reviewer'),
})

const roleSchema = z.object({
  role: z.enum(ROLES),
})

// Returns true if the actor owns the workspace or is an owner/admin member.
async function canManage(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m && (m.role === 'owner' || m.role === 'admin')
}

// GET / — auth — ?workspace_id= list members
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // Caller must be the owner or a member of the workspace to list.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const [self] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  if (ws.owner_id !== userId && !self) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, workspaceId))
    .orderBy(desc(workspace_members.created_at))
  return c.json(rows)
})

// POST / — auth — add member
router.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await canManage(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, body.workspace_id),
        eq(workspace_members.user_id, body.user_id),
      ),
    )
  if (existing) return c.json({ error: 'Member already exists' }, 409)

  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: body.workspace_id, user_id: body.user_id, role: body.role })
    .returning()
  return c.json(member, 201)
})

// PUT /:id — auth — change role
router.put('/:id', authMiddleware, zValidator('json', roleSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspace_members).where(eq(workspace_members.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await canManage(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const { role } = c.req.valid('json')
  const [updated] = await db
    .update(workspace_members)
    .set({ role })
    .where(eq(workspace_members.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — remove member
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspace_members).where(eq(workspace_members.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await canManage(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Do not allow removing the workspace owner's membership.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, existing.workspace_id))
  if (ws && ws.owner_id === existing.user_id) {
    return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  }

  await db.delete(workspace_members).where(eq(workspace_members.id, id))
  return c.json({ success: true })
})

export default router
