import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { updates, risk_scores, risk_factors } from '../db/schema.js'

const router = new Hono()

// GET /:updateId — public — risk score + factor breakdown for an update.
router.get('/:updateId', async (c) => {
  const updateId = c.req.param('updateId')

  const [upd] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!upd) return c.json({ error: 'Update not found' }, 404)

  const [score] = await db.select().from(risk_scores).where(eq(risk_scores.update_id, updateId))
  const factors = await db
    .select()
    .from(risk_factors)
    .where(eq(risk_factors.update_id, updateId))
    .orderBy(asc(risk_factors.factor_type))

  if (!score) {
    return c.json({ score: null, factors, graded: false })
  }

  return c.json({ score, factors, graded: true })
})

// GET /:updateId/factors — public — per-factor rows only.
router.get('/:updateId/factors', async (c) => {
  const updateId = c.req.param('updateId')

  const [upd] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!upd) return c.json({ error: 'Update not found' }, 404)

  const factors = await db
    .select()
    .from(risk_factors)
    .where(eq(risk_factors.update_id, updateId))
    .orderBy(asc(risk_factors.factor_type))

  return c.json(factors)
})

export default router
