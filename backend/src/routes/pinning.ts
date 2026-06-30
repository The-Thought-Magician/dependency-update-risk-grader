import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  pinning_advice,
  projects,
  dependencies,
  packages,
  package_versions,
  workspaces,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Public: list pinning advice for a workspace and/or project.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const projectId = c.req.query('project_id')
  if (!workspaceId && !projectId)
    return c.json({ error: 'workspace_id or project_id is required' }, 400)

  const conds = []
  if (workspaceId) conds.push(eq(pinning_advice.workspace_id, workspaceId))
  if (projectId) conds.push(eq(pinning_advice.project_id, projectId))

  const rows = await db
    .select()
    .from(pinning_advice)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(pinning_advice.created_at))
  return c.json(rows)
})

// Semver helpers (best-effort over typical npm/pypi style strings).
function parseSemver(v: string): [number, number, number] {
  const m = v.trim().replace(/^[\^~v=]+/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

// Build an ecosystem-appropriate manifest patch snippet for a pin.
function patchSnippet(
  ecosystem: string,
  name: string,
  version: string,
): string {
  if (ecosystem === 'pypi' || ecosystem === 'pip') return `${name}==${version}`
  if (ecosystem === 'cargo') return `${name} = "=${version}"`
  if (ecosystem === 'go') return `${name} ${version}`
  // npm / default
  return `"${name}": "${version}"`
}

const generateSchema = z.object({
  project_id: z.string().min(1),
})

// Auth: generate pinning advice for every dependency of a project.
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { project_id } = c.req.valid('json')

  const [project] = await db.select().from(projects).where(eq(projects.id, project_id))
  if (!project) return c.json({ error: 'Project not found' }, 404)

  // Ownership: workspace owner or member.
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, project.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) {
    const [member] = await db
      .select()
      .from(workspace_members)
      .where(
        and(
          eq(workspace_members.workspace_id, ws.id),
          eq(workspace_members.user_id, userId),
        ),
      )
    if (!member) return c.json({ error: 'Forbidden' }, 403)
  }

  const deps = await db.select().from(dependencies).where(eq(dependencies.project_id, project_id))

  // Replace prior advice for this project so the set stays current.
  await db.delete(pinning_advice).where(eq(pinning_advice.project_id, project_id))

  const created: Array<typeof pinning_advice.$inferSelect> = []

  for (const dep of deps) {
    const [pkg] = await db.select().from(packages).where(eq(packages.id, dep.package_id))
    if (!pkg) continue

    // Find the newest known version for this package.
    const versions = await db
      .select()
      .from(package_versions)
      .where(eq(package_versions.package_id, pkg.id))
    let latest = dep.current_version
    for (const v of versions) {
      if (compareSemver(v.version, latest) > 0) latest = v.version
    }

    // Decide on a recommendation from the package's risk signals.
    let recommendation: string
    let rationale: string
    let suggested: string | null = latest

    const usesRange =
      !!dep.version_range && /[\^~xX*]|>=|<=|>|</.test(dep.version_range)

    if (pkg.is_deprecated || pkg.is_archived) {
      recommendation = 'replace'
      suggested = null
      rationale = pkg.is_archived
        ? 'Package repository is archived; plan a migration to a maintained alternative.'
        : 'Package is deprecated; plan a migration to a maintained alternative.'
    } else if (pkg.typosquat_suspect) {
      recommendation = 'pin_exact'
      suggested = dep.current_version
      rationale =
        'Package is flagged as a typosquat suspect; pin the exact reviewed version and audit before changing.'
    } else if (pkg.reputation_tier === 'niche' || pkg.contributor_count <= 1) {
      recommendation = 'pin_exact'
      suggested = dep.current_version
      rationale =
        'Low-reputation / single-maintainer package; pin the exact version to require an explicit, reviewed bump.'
    } else if (usesRange) {
      recommendation = 'narrow_range'
      suggested = dep.current_version
      rationale = `Dependency uses a wide range ("${dep.version_range}"); narrow it to reduce silent transitive drift.`
    } else if (latest !== dep.current_version && compareSemver(latest, dep.current_version) > 0) {
      recommendation = 'pin_latest'
      suggested = latest
      rationale = `A newer reviewed version (${latest}) is available; pin to it explicitly after grading.`
    } else {
      recommendation = 'keep_pinned'
      suggested = dep.current_version
      rationale =
        'Dependency is already pinned to a current, well-reputed version; keep the exact pin.'
    }

    const snippet =
      suggested != null ? patchSnippet(project.ecosystem, pkg.name, suggested) : null

    const [row] = await db
      .insert(pinning_advice)
      .values({
        workspace_id: project.workspace_id,
        project_id: project.id,
        package_id: pkg.id,
        recommendation,
        suggested_version: suggested,
        rationale,
        patch_snippet: snippet,
      })
      .returning()
    created.push(row)
  }

  return c.json({ advice: created })
})

export default router
