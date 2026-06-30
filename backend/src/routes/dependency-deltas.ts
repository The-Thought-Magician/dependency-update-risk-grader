import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  dependency_deltas,
  updates,
  packages,
  package_versions,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

type DepMap = Record<string, string>

interface AddedRemoved {
  name: string
  version: string
}

interface RangeWidened {
  name: string
  from: string
  to: string
}

interface ComputedDelta {
  added: AddedRemoved[]
  removed: AddedRemoved[]
  range_widened: RangeWidened[]
  blast_radius: number
}

// Pull the transitive dependency map declared by a given package version row.
async function versionDeps(packageId: string, version: string): Promise<DepMap> {
  const [row] = await db
    .select()
    .from(package_versions)
    .where(
      and(
        eq(package_versions.package_id, packageId),
        eq(package_versions.version, version),
      ),
    )
  if (!row) return {}
  return (row.dependencies ?? {}) as DepMap
}

// Compare two range strings to decide whether the dependency range widened.
// A widening means the new range admits versions the old one did not. We use a
// deterministic heuristic over common semver range operators (no network).
function rangeRank(range: string): number {
  const r = range.trim()
  if (r === '*' || r === 'latest' || r === '') return 5
  if (r.startsWith('>=') || r.startsWith('>')) return 4
  if (r.startsWith('^')) return 3
  if (r.startsWith('~')) return 2
  // pinned exact version
  return 1
}

function computeDelta(fromDeps: DepMap, toDeps: DepMap): ComputedDelta {
  const added: AddedRemoved[] = []
  const removed: AddedRemoved[] = []
  const range_widened: RangeWidened[] = []

  for (const [name, version] of Object.entries(toDeps)) {
    if (!(name in fromDeps)) {
      added.push({ name, version })
    } else {
      const before = fromDeps[name]
      if (before !== version && rangeRank(version) > rangeRank(before)) {
        range_widened.push({ name, from: before, to: version })
      }
    }
  }

  for (const [name, version] of Object.entries(fromDeps)) {
    if (!(name in toDeps)) {
      removed.push({ name, version })
    }
  }

  // Blast radius: total count of dependency edges touched by this update.
  const blast_radius = added.length + removed.length + range_widened.length

  return { added, removed, range_widened, blast_radius }
}

// Public: dependency tree delta for an update (added / removed / range-widened
// dependencies + blast radius). Computes + persists on first request.
router.get('/:updateId', async (c) => {
  const updateId = c.req.param('updateId')

  const [update] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!update) return c.json({ error: 'Update not found' }, 404)

  const [existing] = await db
    .select()
    .from(dependency_deltas)
    .where(eq(dependency_deltas.update_id, updateId))
  if (existing) return c.json(existing)

  // Compute from the package's from/to version dependency maps.
  const fromDeps = await versionDeps(update.package_id, update.from_version)
  const toDeps = await versionDeps(update.package_id, update.to_version)
  const delta = computeDelta(fromDeps, toDeps)

  const [created] = await db
    .insert(dependency_deltas)
    .values({
      update_id: updateId,
      added: delta.added,
      removed: delta.removed,
      range_widened: delta.range_widened,
      blast_radius: delta.blast_radius,
    })
    .onConflictDoUpdate({
      target: dependency_deltas.update_id,
      set: {
        added: delta.added,
        removed: delta.removed,
        range_widened: delta.range_widened,
        blast_radius: delta.blast_radius,
      },
    })
    .returning()

  // Surface package name for clients alongside the delta.
  const [pkg] = await db.select().from(packages).where(eq(packages.id, update.package_id))
  return c.json({ ...created, package_name: pkg?.name ?? null })
})

export default router
