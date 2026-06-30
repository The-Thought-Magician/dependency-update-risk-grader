import { Hono } from 'hono'
import { desc, eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  maintainers,
  packages,
  package_versions,
  package_maintainers,
} from '../db/schema.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// GET / — list maintainers, optional ?q= username/display-name filter
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const q = c.req.query('q')
  const rows = q
    ? await db
        .select()
        .from(maintainers)
        .where(or(ilike(maintainers.username, `%${q}%`), ilike(maintainers.display_name, `%${q}%`)))
        .orderBy(desc(maintainers.trust_score))
    : await db.select().from(maintainers).orderBy(desc(maintainers.trust_score))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — maintainer profile with the distinct packages they have published
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [maintainer] = await db.select().from(maintainers).where(eq(maintainers.id, id))
  if (!maintainer) return c.json({ error: 'Not found' }, 404)

  const pkgRows = await db
    .select({
      id: packages.id,
      name: packages.name,
      ecosystem: packages.ecosystem,
      reputation_tier: packages.reputation_tier,
      weekly_downloads: packages.weekly_downloads,
      star_count: packages.star_count,
    })
    .from(package_maintainers)
    .innerJoin(package_versions, eq(package_maintainers.package_version_id, package_versions.id))
    .innerJoin(packages, eq(package_versions.package_id, packages.id))
    .where(eq(package_maintainers.maintainer_id, id))

  const seen = new Set<string>()
  const ownedPackages = pkgRows.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })

  return c.json({ ...maintainer, packages: ownedPackages, owned_packages: ownedPackages })
})

export default router
