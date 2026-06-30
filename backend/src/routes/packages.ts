import { Hono } from 'hono'
import { and, desc, eq, ilike } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  packages,
  package_versions,
  package_maintainers,
  maintainers,
} from '../db/schema.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// GET / — list packages, optional ?ecosystem= and ?q= name filter
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const ecosystem = c.req.query('ecosystem')
  const q = c.req.query('q')

  const conditions = []
  if (ecosystem) conditions.push(eq(packages.ecosystem, ecosystem))
  if (q) conditions.push(ilike(packages.name, `%${q}%`))

  const rows = conditions.length
    ? await db
        .select()
        .from(packages)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(packages.weekly_downloads))
    : await db.select().from(packages).orderBy(desc(packages.weekly_downloads))

  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — package profile (inlines versions + distinct maintainers)
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [pkg] = await db.select().from(packages).where(eq(packages.id, id))
  if (!pkg) return c.json({ error: 'Not found' }, 404)

  const versions = await db
    .select()
    .from(package_versions)
    .where(eq(package_versions.package_id, id))
    .orderBy(desc(package_versions.published_at))

  const maintRows = await db
    .select({
      id: maintainers.id,
      username: maintainers.username,
      display_name: maintainers.display_name,
      account_created_at: maintainers.account_created_at,
      packages_owned: maintainers.packages_owned,
      trust_score: maintainers.trust_score,
      prior_incidents: maintainers.prior_incidents,
      reputation: maintainers.reputation,
      role: package_maintainers.role,
    })
    .from(package_maintainers)
    .innerJoin(package_versions, eq(package_maintainers.package_version_id, package_versions.id))
    .innerJoin(maintainers, eq(package_maintainers.maintainer_id, maintainers.id))
    .where(eq(package_versions.package_id, id))

  // De-duplicate maintainers across versions (keep first observed role).
  const seen = new Set<string>()
  const distinctMaintainers = maintRows.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  return c.json({ ...pkg, versions, maintainers: distinctMaintainers })
})

// ----------------------------------------------------------------------------
// GET /:id/versions — version history for a package
// ----------------------------------------------------------------------------

router.get('/:id/versions', async (c) => {
  const id = c.req.param('id')
  const versions = await db
    .select()
    .from(package_versions)
    .where(eq(package_versions.package_id, id))
    .orderBy(desc(package_versions.published_at))
  return c.json(versions)
})

// ----------------------------------------------------------------------------
// GET /:id/maintainers — distinct maintainers that have published a version
// ----------------------------------------------------------------------------

router.get('/:id/maintainers', async (c) => {
  const id = c.req.param('id')
  const rows = await db
    .select({
      id: maintainers.id,
      username: maintainers.username,
      display_name: maintainers.display_name,
      account_created_at: maintainers.account_created_at,
      packages_owned: maintainers.packages_owned,
      trust_score: maintainers.trust_score,
      prior_incidents: maintainers.prior_incidents,
      reputation: maintainers.reputation,
      role: package_maintainers.role,
    })
    .from(package_maintainers)
    .innerJoin(package_versions, eq(package_maintainers.package_version_id, package_versions.id))
    .innerJoin(maintainers, eq(package_maintainers.maintainer_id, maintainers.id))
    .where(eq(package_versions.package_id, id))

  const seen = new Set<string>()
  const distinct = rows.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  return c.json(distinct)
})

export default router
