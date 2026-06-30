import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  manifests,
  projects,
  packages,
  dependencies,
  workspace_members,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function userOwnsProject(projectId: string, userId: string): Promise<boolean> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!proj) return false
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, proj.workspace_id),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!member
}

interface ParsedDep {
  name: string
  range: string
  is_dev: boolean
}

interface ParsedManifest {
  ecosystem: string
  kind: string
  dependencies: ParsedDep[]
  meta: Record<string, unknown>
}

function pinnedVersion(range: string): string {
  // Strip common range operators to get a concrete version for current_version.
  const cleaned = range.trim().replace(/^[\^~><=\s]+/, '').replace(/\s.*$/, '')
  const m = cleaned.match(/\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)?/)
  return m ? m[0] : cleaned || range.trim()
}

function inferEcosystem(filename: string, fallback: string): string {
  const f = filename.toLowerCase()
  if (f === 'package.json' || f === 'package-lock.json' || f === 'pnpm-lock.yaml' || f === 'yarn.lock')
    return 'npm'
  if (f === 'requirements.txt' || f === 'pyproject.toml' || f === 'poetry.lock' || f === 'pipfile')
    return 'pypi'
  if (f === 'cargo.toml' || f === 'cargo.lock') return 'cargo'
  if (f === 'go.mod' || f === 'go.sum') return 'go'
  if (f === 'gemfile' || f === 'gemfile.lock') return 'rubygems'
  return fallback
}

function inferKind(filename: string): string {
  const f = filename.toLowerCase()
  if (
    f.includes('lock') ||
    f === 'go.sum' ||
    f === 'cargo.lock' ||
    f === 'yarn.lock' ||
    f === 'pnpm-lock.yaml'
  )
    return 'lockfile'
  return 'manifest'
}

function parsePackageJson(content: string): ParsedManifest {
  const meta: Record<string, unknown> = {}
  const deps: ParsedDep[] = []
  try {
    const obj = JSON.parse(content) as Record<string, unknown>
    if (typeof obj.name === 'string') meta.name = obj.name
    if (typeof obj.version === 'string') meta.version = obj.version
    const collect = (section: unknown, isDev: boolean) => {
      if (section && typeof section === 'object') {
        for (const [name, range] of Object.entries(section as Record<string, string>)) {
          deps.push({ name, range: String(range), is_dev: isDev })
        }
      }
    }
    collect(obj.dependencies, false)
    collect(obj.devDependencies, true)
    collect(obj.optionalDependencies, false)
  } catch {
    meta.parse_error = 'invalid JSON'
  }
  return { ecosystem: 'npm', kind: 'manifest', dependencies: deps, meta }
}

function parsePackageLock(content: string): ParsedManifest {
  const deps: ParsedDep[] = []
  const meta: Record<string, unknown> = {}
  try {
    const obj = JSON.parse(content) as Record<string, any>
    meta.lockfileVersion = obj.lockfileVersion
    // npm v2/v3 lockfile: "packages" keyed by "node_modules/<name>".
    if (obj.packages && typeof obj.packages === 'object') {
      for (const [path, info] of Object.entries(obj.packages as Record<string, any>)) {
        if (!path || path === '') continue
        const name = path.replace(/^.*node_modules\//, '')
        if (!name) continue
        deps.push({ name, range: String(info?.version ?? ''), is_dev: !!info?.dev })
      }
    } else if (obj.dependencies && typeof obj.dependencies === 'object') {
      // npm v1 lockfile.
      for (const [name, info] of Object.entries(obj.dependencies as Record<string, any>)) {
        deps.push({ name, range: String(info?.version ?? ''), is_dev: !!info?.dev })
      }
    }
  } catch {
    meta.parse_error = 'invalid JSON'
  }
  return { ecosystem: 'npm', kind: 'lockfile', dependencies: deps, meta }
}

function parseRequirementsTxt(content: string): ParsedManifest {
  const deps: ParsedDep[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line || line.startsWith('-')) continue
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/)
    if (!m) continue
    const name = m[1]
    const range = (m[3] || '').trim() || '*'
    deps.push({ name, range, is_dev: false })
  }
  return { ecosystem: 'pypi', kind: 'manifest', dependencies: deps, meta: {} }
}

function parseGenericKeyValue(content: string): ParsedManifest {
  // Best-effort line parser for go.mod / Cargo.toml style "name version" or
  // "name = version" lines. Keeps the platform usable for arbitrary ecosystems.
  const deps: ParsedDep[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/(\/\/|#).*$/, '').trim()
    if (!line) continue
    let m = line.match(/^([\w.\-/@]+)\s*=\s*"?([^"\s]+)"?/) // toml: name = "1.2.3"
    if (!m) m = line.match(/^([\w.\-/@]+)\s+v?([\d][\w.\-+]*)/) // go.mod: name v1.2.3
    if (!m) continue
    deps.push({ name: m[1], range: m[2], is_dev: false })
  }
  return { ecosystem: 'unknown', kind: 'manifest', dependencies: deps, meta: {} }
}

function parseManifest(filename: string, content: string, fallbackEcosystem: string): ParsedManifest {
  const f = filename.toLowerCase()
  let parsed: ParsedManifest
  if (f === 'package.json') parsed = parsePackageJson(content)
  else if (f === 'package-lock.json') parsed = parsePackageLock(content)
  else if (f === 'requirements.txt' || f === 'pipfile') parsed = parseRequirementsTxt(content)
  else if (f === 'go.mod' || f === 'cargo.toml' || f === 'go.sum' || f === 'cargo.lock')
    parsed = parseGenericKeyValue(content)
  else {
    // Try JSON first, then generic.
    const trimmed = content.trim()
    if (trimmed.startsWith('{')) {
      parsed =
        trimmed.includes('"lockfileVersion"') || trimmed.includes('"packages"')
          ? parsePackageLock(content)
          : parsePackageJson(content)
    } else {
      parsed = parseGenericKeyValue(content)
    }
  }
  const ecosystem = inferEcosystem(filename, fallbackEcosystem)
  parsed.ecosystem = ecosystem !== 'unknown' ? ecosystem : parsed.ecosystem
  parsed.kind = inferKind(filename)
  return parsed
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

// GET / — list manifests for a project (public read).
router.get('/', async (c) => {
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ error: 'project_id is required' }, 400)
  const rows = await db
    .select()
    .from(manifests)
    .where(eq(manifests.project_id, projectId))
    .orderBy(manifests.created_at)
  return c.json(rows)
})

// GET /:id — manifest detail (raw + parsed).
router.get('/:id', async (c) => {
  const [m] = await db.select().from(manifests).where(eq(manifests.id, c.req.param('id')))
  if (!m) return c.json({ error: 'Not found' }, 404)
  return c.json(m)
})

const uploadSchema = z.object({
  project_id: z.string().min(1),
  filename: z.string().min(1),
  content: z.string().min(1),
  ecosystem: z.string().optional(),
})

// POST / — upload + parse a manifest. Creates packages + dependencies rows.
router.post('/', authMiddleware, zValidator('json', uploadSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [proj] = await db.select().from(projects).where(eq(projects.id, body.project_id))
  if (!proj) return c.json({ error: 'Project not found' }, 404)
  if (!(await userOwnsProject(body.project_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const fallbackEcosystem = body.ecosystem || proj.ecosystem || 'npm'
  const parsed = parseManifest(body.filename, body.content, fallbackEcosystem)
  const ecosystem = parsed.ecosystem !== 'unknown' ? parsed.ecosystem : fallbackEcosystem

  // Persist the manifest row with its parsed representation.
  const [manifest] = await db
    .insert(manifests)
    .values({
      project_id: body.project_id,
      ecosystem,
      filename: body.filename,
      kind: parsed.kind,
      content: body.content,
      parsed: {
        ecosystem,
        kind: parsed.kind,
        dependency_count: parsed.dependencies.length,
        dependencies: parsed.dependencies,
        meta: parsed.meta,
      },
    })
    .returning()

  // Upsert packages and dependency rows.
  let depRowCount = 0
  for (const dep of parsed.dependencies) {
    if (!dep.name) continue
    // Ensure a package row exists for (name, ecosystem).
    const [existingPkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.name, dep.name), eq(packages.ecosystem, ecosystem)))
    let pkg = existingPkg
    if (!pkg) {
      const [created] = await db
        .insert(packages)
        .values({ name: dep.name, ecosystem })
        .onConflictDoNothing()
        .returning()
      pkg =
        created ??
        (
          await db
            .select()
            .from(packages)
            .where(and(eq(packages.name, dep.name), eq(packages.ecosystem, ecosystem)))
        )[0]
    }
    if (!pkg) continue

    const current = pinnedVersion(dep.range)
    await db
      .insert(dependencies)
      .values({
        project_id: body.project_id,
        package_id: pkg.id,
        current_version: current || dep.range || '0.0.0',
        version_range: dep.range,
        is_direct: parsed.kind !== 'lockfile',
        is_dev: dep.is_dev,
      })
      .onConflictDoUpdate({
        target: [dependencies.project_id, dependencies.package_id],
        set: {
          current_version: current || dep.range || '0.0.0',
          version_range: dep.range,
          is_dev: dep.is_dev,
        },
      })
    depRowCount++
  }

  // Refresh the project's dependency_count to reflect inventory.
  const projDeps = await db
    .select()
    .from(dependencies)
    .where(eq(dependencies.project_id, body.project_id))
  await db
    .update(projects)
    .set({ dependency_count: projDeps.length, updated_at: new Date() })
    .where(eq(projects.id, body.project_id))

  return c.json({ ...manifest, created_dependencies: depRowCount }, 201)
})

// DELETE /:id — remove a manifest (auth + ownership).
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(manifests).where(eq(manifests.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await userOwnsProject(existing.project_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(manifests).where(eq(manifests.id, id))
  return c.json({ success: true })
})

export default router
