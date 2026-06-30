import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, or, inArray, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  policies,
  projects,
  packages,
  package_versions,
  dependencies,
  updates,
  incidents,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Defaults for seeded policies
// ----------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Record<string, number> = {
  maintainer_change: 0.18,
  publish_cadence: 0.1,
  install_scripts: 0.18,
  provenance: 0.12,
  dependency_delta: 0.12,
  reputation: 0.1,
  bump_magnitude: 0.08,
  typosquat: 0.07,
  deprecation: 0.05,
}

const DEFAULT_GRADE_BANDS: Record<string, number> = {
  A: 15,
  B: 35,
  C: 55,
  D: 75,
  F: 100,
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
}

// ----------------------------------------------------------------------------
// Sample-data reseed for a workspace
// ----------------------------------------------------------------------------

async function reseedWorkspaceData(workspaceId: string, ownerId: string): Promise<void> {
  // Ensure a few well-known packages exist (idempotent via unique(name,ecosystem)).
  const samplePackages: Array<{
    name: string
    ecosystem: string
    reputation_tier: string
    weekly_downloads: number
    download_trend: number
    star_count: number
    contributor_count: number
    repo_url: string
    is_deprecated: boolean
    typosquat_suspect: boolean
    versions: Array<{
      version: string
      has_provenance: boolean
      signature_present: boolean
      slsa_level: number
      publisher_2fa: boolean
      install_scripts: Record<string, string>
      file_count: number
      lines_added: number
      lines_removed: number
      tarball_matches_repo: boolean
    }>
  }> = [
    {
      name: 'left-pad',
      ecosystem: 'npm',
      reputation_tier: 'popular',
      weekly_downloads: 4_200_000,
      download_trend: 0.02,
      star_count: 1100,
      contributor_count: 12,
      repo_url: 'https://github.com/stevemao/left-pad',
      is_deprecated: false,
      typosquat_suspect: false,
      versions: [
        { version: '1.3.0', has_provenance: true, signature_present: true, slsa_level: 2, publisher_2fa: true, install_scripts: {}, file_count: 4, lines_added: 10, lines_removed: 2, tarball_matches_repo: true },
        { version: '1.4.0', has_provenance: true, signature_present: true, slsa_level: 2, publisher_2fa: true, install_scripts: {}, file_count: 4, lines_added: 22, lines_removed: 4, tarball_matches_repo: true },
      ],
    },
    {
      name: 'event-stream',
      ecosystem: 'npm',
      reputation_tier: 'popular',
      weekly_downloads: 1_900_000,
      download_trend: -0.1,
      star_count: 2100,
      contributor_count: 30,
      repo_url: 'https://github.com/dominictarr/event-stream',
      is_deprecated: false,
      typosquat_suspect: false,
      versions: [
        { version: '3.3.5', has_provenance: true, signature_present: true, slsa_level: 1, publisher_2fa: true, install_scripts: {}, file_count: 20, lines_added: 5, lines_removed: 1, tarball_matches_repo: true },
        { version: '3.3.6', has_provenance: false, signature_present: false, slsa_level: 0, publisher_2fa: false, install_scripts: { postinstall: 'node ./build.js' }, file_count: 41, lines_added: 920, lines_removed: 3, tarball_matches_repo: false },
      ],
    },
    {
      name: 'chalk',
      ecosystem: 'npm',
      reputation_tier: 'popular',
      weekly_downloads: 280_000_000,
      download_trend: 0.01,
      star_count: 21000,
      contributor_count: 80,
      repo_url: 'https://github.com/chalk/chalk',
      is_deprecated: false,
      typosquat_suspect: false,
      versions: [
        { version: '5.3.0', has_provenance: true, signature_present: true, slsa_level: 3, publisher_2fa: true, install_scripts: {}, file_count: 12, lines_added: 30, lines_removed: 10, tarball_matches_repo: true },
        { version: '5.4.0', has_provenance: true, signature_present: true, slsa_level: 3, publisher_2fa: true, install_scripts: {}, file_count: 12, lines_added: 48, lines_removed: 14, tarball_matches_repo: true },
      ],
    },
  ]

  const pkgIdByName: Record<string, string> = {}
  for (const sp of samplePackages) {
    let [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.name, sp.name), eq(packages.ecosystem, sp.ecosystem)))
    if (!pkg) {
      ;[pkg] = await db
        .insert(packages)
        .values({
          name: sp.name,
          ecosystem: sp.ecosystem,
          reputation_tier: sp.reputation_tier,
          weekly_downloads: sp.weekly_downloads,
          download_trend: sp.download_trend,
          star_count: sp.star_count,
          contributor_count: sp.contributor_count,
          repo_url: sp.repo_url,
          is_deprecated: sp.is_deprecated,
          typosquat_suspect: sp.typosquat_suspect,
        })
        .returning()
    }
    pkgIdByName[sp.name] = pkg.id

    for (const v of sp.versions) {
      const [existingV] = await db
        .select()
        .from(package_versions)
        .where(and(eq(package_versions.package_id, pkg.id), eq(package_versions.version, v.version)))
      if (!existingV) {
        await db.insert(package_versions).values({
          package_id: pkg.id,
          version: v.version,
          published_at: new Date(),
          published_hour: 14,
          has_provenance: v.has_provenance,
          signature_present: v.signature_present,
          slsa_level: v.slsa_level,
          publisher_2fa: v.publisher_2fa,
          install_scripts: v.install_scripts,
          file_count: v.file_count,
          lines_added: v.lines_added,
          lines_removed: v.lines_removed,
          tarball_matches_repo: v.tarball_matches_repo,
        })
      }
    }
  }

  // Create a sample project in this workspace if none exists yet.
  const existingProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.workspace_id, workspaceId))
  if (existingProjects.length === 0) {
    const [proj] = await db
      .insert(projects)
      .values({
        workspace_id: workspaceId,
        name: 'web-frontend',
        ecosystem: 'npm',
        repo_url: 'https://github.com/example/web-frontend',
        tags: ['production', 'frontend'],
        dependency_count: 0,
        created_by: ownerId,
      })
      .returning()

    let depCount = 0
    for (const sp of samplePackages) {
      const pkgId = pkgIdByName[sp.name]
      if (!pkgId) continue
      const current = sp.versions[0]?.version ?? '0.0.0'
      const [existingDep] = await db
        .select()
        .from(dependencies)
        .where(and(eq(dependencies.project_id, proj.id), eq(dependencies.package_id, pkgId)))
      if (!existingDep) {
        await db.insert(dependencies).values({
          project_id: proj.id,
          package_id: pkgId,
          current_version: current,
          version_range: `^${current}`,
          is_direct: true,
          is_dev: false,
        })
        depCount++
      }
    }
    await db
      .update(projects)
      .set({ dependency_count: depCount, updated_at: new Date() })
      .where(eq(projects.id, proj.id))

    // Seed a few pending updates (bump PRs) for the sample project.
    for (const sp of samplePackages) {
      const pkgId = pkgIdByName[sp.name]
      if (!pkgId || sp.versions.length < 2) continue
      const from = sp.versions[0].version
      const to = sp.versions[1].version
      const [existingUpdate] = await db
        .select()
        .from(updates)
        .where(
          and(
            eq(updates.project_id, proj.id),
            eq(updates.package_id, pkgId),
            eq(updates.to_version, to),
          ),
        )
      if (!existingUpdate) {
        await db.insert(updates).values({
          workspace_id: workspaceId,
          project_id: proj.id,
          package_id: pkgId,
          from_version: from,
          to_version: to,
          ecosystem: sp.ecosystem,
          bump_type: 'minor',
          source: 'sample',
          status: 'pending',
          created_by: ownerId,
        })
      }
    }
  }

  // Ensure global incident library has at least the canonical replays.
  const existingIncidents = await db.select().from(incidents).limit(1)
  if (existingIncidents.length === 0) {
    const sampleIncidents = [
      {
        slug: 'event-stream-2018',
        name: 'event-stream / flatmap-stream compromise',
        ecosystem: 'npm',
        package_name: 'event-stream',
        from_version: '3.3.5',
        to_version: '3.3.6',
        year: 2018,
        summary: 'A new maintainer added a malicious transitive dependency that stole cryptocurrency wallet keys.',
        catching_factor: 'maintainer_change',
        expected_grade: 'F',
        details: { vector: 'transitive-dependency', payload: 'wallet-exfiltration' },
      },
      {
        slug: 'ua-parser-js-2021',
        name: 'ua-parser-js account takeover',
        ecosystem: 'npm',
        package_name: 'ua-parser-js',
        from_version: '0.7.28',
        to_version: '0.7.29',
        year: 2021,
        summary: 'Compromised maintainer account published versions with a crypto-miner and password stealer via install scripts.',
        catching_factor: 'install_scripts',
        expected_grade: 'F',
        details: { vector: 'install-script', payload: 'crypto-miner' },
      },
    ]
    for (const inc of sampleIncidents) {
      await db.insert(incidents).values(inc).onConflictDoNothing()
    }
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).optional(),
  default_ecosystem: z.string().min(1).max(40).optional(),
  auto_clear_max_grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(60).optional(),
  default_ecosystem: z.string().min(1).max(40).optional(),
  default_policy_id: z.string().nullable().optional(),
  auto_clear_max_grade: z.enum(['A', 'B', 'C', 'D', 'F']).optional(),
})

// GET / — auth — list workspaces the user owns or is a member of
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select({ workspace_id: workspace_members.workspace_id })
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const memberIds = memberships.map((m) => m.workspace_id)

  const rows = await db
    .select()
    .from(workspaces)
    .where(
      memberIds.length > 0
        ? or(eq(workspaces.owner_id, userId), inArray(workspaces.id, memberIds))
        : eq(workspaces.owner_id, userId),
    )
    .orderBy(desc(workspaces.created_at))
  return c.json(rows)
})

// GET /:id — public — workspace detail
router.get('/:id', async (c) => {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, c.req.param('id')))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// POST / — auth — create workspace (auto-add owner as member + seed default policy)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  let slug = body.slug ? slugify(body.slug) : slugify(body.name)
  // Ensure slug uniqueness by suffixing if necessary.
  const [slugTaken] = await db.select().from(workspaces).where(eq(workspaces.slug, slug))
  if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      slug,
      owner_id: userId,
      default_ecosystem: body.default_ecosystem ?? 'npm',
      auto_clear_max_grade: body.auto_clear_max_grade ?? 'B',
    })
    .returning()

  // Auto-add owner as a member.
  await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()

  // Seed a default policy and link it.
  const [policy] = await db
    .insert(policies)
    .values({
      workspace_id: ws.id,
      name: 'Default Policy',
      description: 'Baseline risk weights and grade bands.',
      weights: DEFAULT_WEIGHTS,
      grade_bands: DEFAULT_GRADE_BANDS,
      auto_clear_max_grade: ws.auto_clear_max_grade,
      is_default: true,
      created_by: userId,
    })
    .returning()

  const [updated] = await db
    .update(workspaces)
    .set({ default_policy_id: policy.id, updated_at: new Date() })
    .where(eq(workspaces.id, ws.id))
    .returning()

  return c.json(updated, 201)
})

// PUT /:id — auth(owner) — update workspace settings
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.default_ecosystem !== undefined) patch.default_ecosystem = body.default_ecosystem
  if (body.default_policy_id !== undefined) patch.default_policy_id = body.default_policy_id
  if (body.auto_clear_max_grade !== undefined) patch.auto_clear_max_grade = body.auto_clear_max_grade
  if (body.slug !== undefined) {
    let slug = slugify(body.slug)
    const [taken] = await db.select().from(workspaces).where(eq(workspaces.slug, slug))
    if (taken && taken.id !== id) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
    patch.slug = slug
  }

  const [updated] = await db
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth(owner) — delete workspace + members + default policy
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Detach policy reference first to avoid FK issues, then remove dependents.
  await db.update(workspaces).set({ default_policy_id: null }).where(eq(workspaces.id, id))
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(policies).where(eq(policies.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

// POST /:id/reseed — auth(owner) — reseed sample data for this workspace
router.post('/:id/reseed', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await reseedWorkspaceData(id, existing.owner_id)
  return c.json({ success: true })
})

export default router
