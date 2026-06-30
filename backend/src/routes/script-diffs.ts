import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { updates, script_diffs } from '../db/schema.js'

const router = new Hono()

// GET /:updateId — public — lifecycle-script diff for an update.
// Reports added/removed/changed install hooks plus the derived flags
// (new install hook, remote fetch, obfuscation, native build).
router.get('/:updateId', async (c) => {
  const updateId = c.req.param('updateId')

  const [upd] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!upd) return c.json({ error: 'Update not found' }, 404)

  const [diff] = await db.select().from(script_diffs).where(eq(script_diffs.update_id, updateId))

  if (!diff) {
    // Update exists but has not been graded yet — return an empty, well-shaped diff.
    return c.json({
      update_id: updateId,
      added_scripts: {},
      removed_scripts: {},
      changed_scripts: {},
      has_new_install_hook: false,
      fetches_remote: false,
      obfuscation_suspect: false,
      native_build_hook: false,
      graded: false,
    })
  }

  return c.json({ ...diff, graded: true })
})

export default router
