import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  updates,
  workspaces,
  workspace_members,
  projects,
  packages,
  package_versions,
  package_maintainers,
  maintainers,
  risk_scores,
  risk_factors,
  script_diffs,
  dependency_deltas,
  policies,
  incidents,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Default risk model — mirrors the seed in index.ts. These are used when a
// workspace has no default policy or the policy carries no custom weights.
// ----------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Record<string, number> = {
  maintainer_change: 0.2,
  install_scripts: 0.2,
  publish_cadence: 0.1,
  provenance: 0.15,
  blast_radius: 0.15,
  version_jump: 0.1,
  reputation: 0.1,
}

const DEFAULT_BANDS: Record<string, number> = { A: 20, B: 40, C: 60, D: 80, F: 100 }

const FACTOR_TYPES = [
  'maintainer_change',
  'install_scripts',
  'publish_cadence',
  'provenance',
  'blast_radius',
  'version_jump',
  'reputation',
] as const

type FactorType = (typeof FACTOR_TYPES)[number]

interface ComputedFactor {
  factor_type: FactorType
  raw_value: number
  sub_score: number
  weight: number
  contribution: number
  detail: Record<string, unknown>
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n))
}

function semverParts(v: string): [number, number, number] {
  const clean = v.replace(/^[^\d]*/, '')
  const [maj, min, pat] = clean.split('.').map((p) => parseInt(p, 10))
  return [
    Number.isFinite(maj) ? maj : 0,
    Number.isFinite(min) ? min : 0,
    Number.isFinite(pat) ? pat : 0,
  ]
}

function inferBumpType(from: string, to: string): 'major' | 'minor' | 'patch' {
  const [fMaj, fMin] = semverParts(from)
  const [tMaj, tMin] = semverParts(to)
  if (tMaj > fMaj) return 'major'
  if (tMin > fMin) return 'minor'
  return 'patch'
}

// Detect remote-fetch / obfuscation patterns inside install-script command text.
function scriptFlags(scripts: Record<string, string>): {
  fetchesRemote: boolean
  obfuscation: boolean
  nativeBuild: boolean
} {
  const cmds = Object.values(scripts).join(' ').toLowerCase()
  const fetchesRemote =
    /\b(curl|wget|fetch|https?:\/\/|node-fetch|axios|nc\s|bash\s+-c)\b/.test(cmds)
  const obfuscation =
    /(eval\(|base64|atob\(|fromcharcode|\\x[0-9a-f]{2}|child_process|\bexec\b)/.test(cmds)
  const nativeBuild = /\b(node-gyp|prebuild|make\b|gcc|g\+\+|cmake|cargo build)\b/.test(cmds)
  return { fetchesRemote, obfuscation, nativeBuild }
}

function gradeFromScore(score: number, bands: Record<string, number>): string {
  const b = { ...DEFAULT_BANDS, ...bands }
  if (score <= b.A) return 'A'
  if (score <= b.B) return 'B'
  if (score <= b.C) return 'C'
  if (score <= b.D) return 'D'
  return 'F'
}

async function resolveWeightsBands(
  workspaceId: string,
): Promise<{ weights: Record<string, number>; bands: Record<string, number> }> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  let policy: typeof policies.$inferSelect | undefined
  if (ws?.default_policy_id) {
    ;[policy] = await db.select().from(policies).where(eq(policies.id, ws.default_policy_id))
  }
  if (!policy) {
    ;[policy] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.workspace_id, workspaceId), eq(policies.is_default, true)))
  }
  const weights =
    policy?.weights && Object.keys(policy.weights).length > 0 ? policy.weights : DEFAULT_WEIGHTS
  const bands =
    policy?.grade_bands && Object.keys(policy.grade_bands).length > 0
      ? policy.grade_bands
      : DEFAULT_BANDS
  return { weights: { ...DEFAULT_WEIGHTS, ...weights }, bands: { ...DEFAULT_BANDS, ...bands } }
}

async function maintainersForVersion(versionId: string | undefined) {
  if (!versionId) return [] as Array<typeof maintainers.$inferSelect>
  const rows = await db
    .select({ m: maintainers })
    .from(package_maintainers)
    .innerJoin(maintainers, eq(package_maintainers.maintainer_id, maintainers.id))
    .where(eq(package_maintainers.package_version_id, versionId))
  return rows.map((r) => r.m)
}

// ----------------------------------------------------------------------------
// Core deterministic grading engine. Recomputes risk_factors, risk_scores,
// script_diffs and dependency_deltas for a single update. Idempotent: deletes
// then re-inserts the derived rows so it is safe to re-run.
// ----------------------------------------------------------------------------

async function gradeUpdate(updateId: string): Promise<void> {
  const [upd] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!upd) return

  const [pkg] = await db.select().from(packages).where(eq(packages.id, upd.package_id))

  // Resolve the from/to package_versions rows (best-effort by version string).
  const allVersions = await db
    .select()
    .from(package_versions)
    .where(eq(package_versions.package_id, upd.package_id))
  const fromVer = allVersions.find((v) => v.version === upd.from_version)
  const toVer = allVersions.find((v) => v.version === upd.to_version)

  const { weights, bands } = await resolveWeightsBands(upd.workspace_id)

  // --- maintainer_change: new publisher appears on the target version --------
  const fromMaint = await maintainersForVersion(fromVer?.id)
  const toMaint = await maintainersForVersion(toVer?.id)
  const fromNames = new Set(fromMaint.map((m) => m.username))
  const newMaintainers = toMaint.filter((m) => !fromNames.has(m.username))
  const lowestNewTrust = newMaintainers.length
    ? Math.min(...newMaintainers.map((m) => m.trust_score))
    : 100
  const maintainerChangeRaw = newMaintainers.length > 0 ? 1 : 0
  let maintainerSub = 0
  if (newMaintainers.length > 0) {
    // New publisher with low trust is the strongest single signal.
    maintainerSub = clamp(60 + (100 - lowestNewTrust) * 0.4)
    if (newMaintainers.some((m) => m.prior_incidents > 0)) maintainerSub = clamp(maintainerSub + 15)
  }

  // --- install_scripts: new/changed lifecycle hooks --------------------------
  const fromScripts = (fromVer?.install_scripts ?? {}) as Record<string, string>
  const toScripts = (toVer?.install_scripts ?? {}) as Record<string, string>
  const added: Record<string, string> = {}
  const removed: Record<string, string> = {}
  const changed: Record<string, { from: string; to: string }> = {}
  for (const [k, v] of Object.entries(toScripts)) {
    if (!(k in fromScripts)) added[k] = v
    else if (fromScripts[k] !== v) changed[k] = { from: fromScripts[k], to: v }
  }
  for (const [k, v] of Object.entries(fromScripts)) {
    if (!(k in toScripts)) removed[k] = v
  }
  const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']
  const hasNewInstallHook = Object.keys({ ...added, ...changed }).some((k) =>
    INSTALL_HOOKS.includes(k),
  )
  const toFlags = scriptFlags(toScripts)
  let installSub = 0
  const installAdded = Object.keys(added)
  const installChanged = Object.keys(changed)
  if (hasNewInstallHook) installSub = clamp(installSub + 70)
  else if (installAdded.length > 0 || installChanged.length > 0) installSub = clamp(installSub + 30)
  if (toFlags.fetchesRemote) installSub = clamp(installSub + 20)
  if (toFlags.obfuscation) installSub = clamp(installSub + 25)
  const installRaw = installAdded.length + installChanged.length > 0 ? 1 : 0

  // --- publish_cadence: off-hours / rushed publish ---------------------------
  const publishHour = toVer?.published_hour ?? null
  const offHours = publishHour !== null && (publishHour < 6 || publishHour >= 22)
  let cadenceSub = 0
  let cadenceRaw = 0
  if (offHours) {
    cadenceSub = 55
    cadenceRaw = 1
  }
  // Large diff in a single publish is also suspicious cadence.
  const churn = (toVer?.lines_added ?? 0) + (toVer?.lines_removed ?? 0)
  if (churn > 500) {
    cadenceSub = clamp(cadenceSub + 25)
    cadenceRaw = 1
  }

  // --- provenance: attestation / signature / 2FA / tarball match -------------
  let provenanceSub = 0
  if (toVer) {
    if (!toVer.has_provenance) provenanceSub += 25
    if (!toVer.signature_present) provenanceSub += 20
    if (!toVer.publisher_2fa) provenanceSub += 25
    if (!toVer.tarball_matches_repo) provenanceSub += 30
    provenanceSub = clamp(provenanceSub)
  } else {
    provenanceSub = 50 // unknown target version -> moderate uncertainty
  }
  const provenanceRaw = toVer ? (toVer.has_provenance ? 0 : 1) : 1

  // --- blast_radius: how many transitive deps the new version pulls ----------
  const toDeps = (toVer?.dependencies ?? {}) as Record<string, string>
  const fromDeps = (fromVer?.dependencies ?? {}) as Record<string, string>
  const addedDeps = Object.keys(toDeps).filter((d) => !(d in fromDeps))
  const removedDeps = Object.keys(fromDeps).filter((d) => !(d in toDeps))
  const blastRadius = Object.keys(toDeps).length
  let blastSub = clamp(Math.min(blastRadius, 50) * 1.5 + addedDeps.length * 8)
  blastSub = clamp(blastSub)
  const blastRaw = blastRadius

  // --- version_jump: semver distance -----------------------------------------
  const bumpType = upd.bump_type || inferBumpType(upd.from_version, upd.to_version)
  let versionSub = 0
  let versionRaw = 0
  if (bumpType === 'major') {
    versionSub = 60
    versionRaw = 3
  } else if (bumpType === 'minor') {
    versionSub = 25
    versionRaw = 2
  } else {
    versionSub = 8
    versionRaw = 1
  }

  // --- reputation: package standing -------------------------------------------
  let reputationSub = 50
  if (pkg) {
    const tierScore: Record<string, number> = {
      popular: 5,
      established: 20,
      niche: 55,
      unknown: 80,
    }
    reputationSub = tierScore[pkg.reputation_tier] ?? 55
    if (pkg.is_deprecated) reputationSub = clamp(reputationSub + 20)
    if (pkg.is_archived) reputationSub = clamp(reputationSub + 15)
    if (pkg.typosquat_suspect) reputationSub = clamp(reputationSub + 30)
    if (pkg.download_trend < -0.3) reputationSub = clamp(reputationSub + 10)
    reputationSub = clamp(reputationSub)
  }
  const reputationRaw = pkg?.typosquat_suspect ? 1 : 0

  const subScores: Record<FactorType, { raw: number; sub: number; detail: Record<string, unknown> }> = {
    maintainer_change: {
      raw: maintainerChangeRaw,
      sub: maintainerSub,
      detail: {
        from: fromMaint.map((m) => m.username),
        to: toMaint.map((m) => m.username),
        new_maintainers: newMaintainers.map((m) => ({
          username: m.username,
          trust_score: m.trust_score,
          prior_incidents: m.prior_incidents,
        })),
      },
    },
    install_scripts: {
      raw: installRaw,
      sub: installSub,
      detail: {
        added: installAdded,
        changed: installChanged,
        removed: Object.keys(removed),
        has_new_install_hook: hasNewInstallHook,
        fetches_remote: toFlags.fetchesRemote,
        obfuscation_suspect: toFlags.obfuscation,
        native_build_hook: toFlags.nativeBuild,
      },
    },
    publish_cadence: {
      raw: cadenceRaw,
      sub: cadenceSub,
      detail: { published_hour: publishHour, off_hours: offHours, churn },
    },
    provenance: {
      raw: provenanceRaw,
      sub: provenanceSub,
      detail: {
        has_provenance: toVer?.has_provenance ?? null,
        signature_present: toVer?.signature_present ?? null,
        publisher_2fa: toVer?.publisher_2fa ?? null,
        slsa_level: toVer?.slsa_level ?? null,
        tarball_matches_repo: toVer?.tarball_matches_repo ?? null,
      },
    },
    blast_radius: {
      raw: blastRaw,
      sub: blastSub,
      detail: { dependency_count: blastRadius, added: addedDeps, removed: removedDeps },
    },
    version_jump: {
      raw: versionRaw,
      sub: versionSub,
      detail: { bump_type: bumpType, from: upd.from_version, to: upd.to_version },
    },
    reputation: {
      raw: reputationRaw,
      sub: reputationSub,
      detail: {
        reputation_tier: pkg?.reputation_tier ?? null,
        weekly_downloads: pkg?.weekly_downloads ?? null,
        download_trend: pkg?.download_trend ?? null,
        is_deprecated: pkg?.is_deprecated ?? null,
        is_archived: pkg?.is_archived ?? null,
        typosquat_suspect: pkg?.typosquat_suspect ?? null,
      },
    },
  }

  // Weighted total (0..100). Weights are normalized so they always sum to 1.
  const weightSum =
    FACTOR_TYPES.reduce((acc, f) => acc + (weights[f] ?? DEFAULT_WEIGHTS[f] ?? 0), 0) || 1
  const computed: ComputedFactor[] = FACTOR_TYPES.map((f) => {
    const w = (weights[f] ?? DEFAULT_WEIGHTS[f] ?? 0) / weightSum
    const { raw, sub, detail } = subScores[f]
    const contribution = Math.round(sub * w * 100) / 100
    return {
      factor_type: f,
      raw_value: raw,
      sub_score: Math.round(sub * 100) / 100,
      weight: Math.round(w * 1000) / 1000,
      contribution,
      detail,
    }
  })

  const total = Math.round(computed.reduce((acc, f) => acc + f.contribution, 0) * 100) / 100
  const grade = gradeFromScore(total, bands)

  // Confidence: lower when we lacked the target version row to inspect.
  const confidence = toVer ? (fromVer ? 0.95 : 0.85) : 0.6

  const breakdown = computed.map((f) => ({
    factor: f.factor_type,
    raw: f.raw_value,
    sub_score: f.sub_score,
    weight: f.weight,
    contribution: f.contribution,
  }))

  // --- persist: risk_factors (replace) ---------------------------------------
  await db.delete(risk_factors).where(eq(risk_factors.update_id, updateId))
  await db.insert(risk_factors).values(
    computed.map((f) => ({
      update_id: updateId,
      factor_type: f.factor_type,
      raw_value: f.raw_value,
      sub_score: f.sub_score,
      weight: f.weight,
      contribution: f.contribution,
      detail: f.detail,
    })),
  )

  // --- persist: risk_scores (upsert by unique update_id) ---------------------
  await db
    .insert(risk_scores)
    .values({ update_id: updateId, total_score: total, grade, confidence, breakdown })
    .onConflictDoUpdate({
      target: risk_scores.update_id,
      set: { total_score: total, grade, confidence, breakdown, computed_at: new Date() },
    })

  // --- persist: script_diffs (upsert) ----------------------------------------
  await db
    .insert(script_diffs)
    .values({
      update_id: updateId,
      added_scripts: added,
      removed_scripts: removed,
      changed_scripts: changed,
      has_new_install_hook: hasNewInstallHook,
      fetches_remote: toFlags.fetchesRemote,
      obfuscation_suspect: toFlags.obfuscation,
      native_build_hook: toFlags.nativeBuild,
    })
    .onConflictDoUpdate({
      target: script_diffs.update_id,
      set: {
        added_scripts: added,
        removed_scripts: removed,
        changed_scripts: changed,
        has_new_install_hook: hasNewInstallHook,
        fetches_remote: toFlags.fetchesRemote,
        obfuscation_suspect: toFlags.obfuscation,
        native_build_hook: toFlags.nativeBuild,
      },
    })

  // --- persist: dependency_deltas (upsert) -----------------------------------
  const deltaAdded = addedDeps.map((name) => ({ name, version: toDeps[name] }))
  const deltaRemoved = removedDeps.map((name) => ({ name, version: fromDeps[name] }))
  const rangeWidened: Array<{ name: string; from: string; to: string }> = []
  for (const [name, toRange] of Object.entries(toDeps)) {
    if (name in fromDeps && fromDeps[name] !== toRange) {
      rangeWidened.push({ name, from: fromDeps[name], to: toRange })
    }
  }
  await db
    .insert(dependency_deltas)
    .values({
      update_id: updateId,
      added: deltaAdded,
      removed: deltaRemoved,
      range_widened: rangeWidened,
      blast_radius: blastRadius,
    })
    .onConflictDoUpdate({
      target: dependency_deltas.update_id,
      set: {
        added: deltaAdded,
        removed: deltaRemoved,
        range_widened: rangeWidened,
        blast_radius: blastRadius,
      },
    })
}

// ----------------------------------------------------------------------------
// Ownership: a user may write to an update only if they belong to its workspace.
// ----------------------------------------------------------------------------

async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (ws && ws.owner_id === userId) return true
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Build a fully-joined update-detail payload.
async function buildDetail(updateId: string) {
  const [upd] = await db.select().from(updates).where(eq(updates.id, updateId))
  if (!upd) return null
  const [pkg] = await db.select().from(packages).where(eq(packages.id, upd.package_id))
  const [proj] = await db.select().from(projects).where(eq(projects.id, upd.project_id))
  const [score] = await db.select().from(risk_scores).where(eq(risk_scores.update_id, updateId))
  const factors = await db.select().from(risk_factors).where(eq(risk_factors.update_id, updateId))
  const [scriptDiff] = await db
    .select()
    .from(script_diffs)
    .where(eq(script_diffs.update_id, updateId))
  const [depDelta] = await db
    .select()
    .from(dependency_deltas)
    .where(eq(dependency_deltas.update_id, updateId))
  return {
    ...upd,
    package: pkg ?? null,
    project: proj ?? null,
    score: score ?? null,
    grade: score?.grade ?? null,
    factors,
    script_diff: scriptDiff ?? null,
    dependency_delta: depDelta ?? null,
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

// GET / — public list, joined grade, filterable by workspace/status/project.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const status = c.req.query('status')
  const projectId = c.req.query('project_id')

  const conds = []
  if (workspaceId) conds.push(eq(updates.workspace_id, workspaceId))
  if (status) conds.push(eq(updates.status, status))
  if (projectId) conds.push(eq(updates.project_id, projectId))

  const rows = await db
    .select({
      update: updates,
      pkg: packages,
      proj: projects,
      score: risk_scores,
    })
    .from(updates)
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .leftJoin(projects, eq(updates.project_id, projects.id))
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(updates.created_at))

  return c.json(
    rows.map((r) => ({
      ...r.update,
      package: r.pkg ?? null,
      package_name: r.pkg?.name ?? null,
      project: r.proj ?? null,
      project_name: r.proj?.name ?? null,
      score: r.score ?? null,
      grade: r.score?.grade ?? null,
      total_score: r.score?.total_score ?? null,
    })),
  )
})

// GET /:id — public detail with full joins.
router.get('/:id', async (c) => {
  const detail = await buildDetail(c.req.param('id'))
  if (!detail) return c.json({ error: 'Not found' }, 404)
  return c.json(detail)
})

const createSchema = z.object({
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  package_id: z.string().min(1),
  from_version: z.string().min(1),
  to_version: z.string().min(1),
  ecosystem: z.string().optional(),
  bump_type: z.enum(['major', 'minor', 'patch']).optional(),
  source: z.string().optional(),
  source_pr_url: z.string().url().optional().nullable(),
  assigned_to: z.string().optional().nullable(),
})

// POST / — auth — create a bump-PR update, then grade it.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isWorkspaceMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const [proj] = await db.select().from(projects).where(eq(projects.id, body.project_id))
  if (!proj || proj.workspace_id !== body.workspace_id)
    return c.json({ error: 'Project does not belong to workspace' }, 400)
  const [pkg] = await db.select().from(packages).where(eq(packages.id, body.package_id))
  if (!pkg) return c.json({ error: 'Unknown package' }, 400)

  const [created] = await db
    .insert(updates)
    .values({
      workspace_id: body.workspace_id,
      project_id: body.project_id,
      package_id: body.package_id,
      from_version: body.from_version,
      to_version: body.to_version,
      ecosystem: body.ecosystem ?? pkg.ecosystem,
      bump_type: body.bump_type ?? inferBumpType(body.from_version, body.to_version),
      source: body.source ?? 'manual',
      source_pr_url: body.source_pr_url ?? null,
      assigned_to: body.assigned_to ?? null,
      status: 'pending',
      created_by: userId,
    })
    .returning()

  await gradeUpdate(created.id)
  const detail = await buildDetail(created.id)
  return c.json(detail, 201)
})

// POST /import — auth — bulk import a Dependabot/Renovate JSON payload.
const importItemSchema = z.object({
  package_name: z.string().min(1).optional(),
  package_id: z.string().optional(),
  from_version: z.string().min(1),
  to_version: z.string().min(1),
  ecosystem: z.string().optional(),
  bump_type: z.enum(['major', 'minor', 'patch']).optional(),
  source_pr_url: z.string().optional().nullable(),
})

const importSchema = z.object({
  workspace_id: z.string().min(1),
  project_id: z.string().min(1),
  source: z.string().optional(),
  updates: z.array(importItemSchema).min(1),
})

router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isWorkspaceMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const [proj] = await db.select().from(projects).where(eq(projects.id, body.project_id))
  if (!proj || proj.workspace_id !== body.workspace_id)
    return c.json({ error: 'Project does not belong to workspace' }, 400)

  const createdIds: string[] = []
  for (const item of body.updates) {
    // Resolve the package: by explicit id, else by (name, ecosystem). Create a
    // minimal package row if it does not exist yet so the import never fails.
    let pkgId = item.package_id
    const eco = item.ecosystem ?? proj.ecosystem
    if (!pkgId && item.package_name) {
      const [existing] = await db
        .select()
        .from(packages)
        .where(and(eq(packages.name, item.package_name), eq(packages.ecosystem, eco)))
      if (existing) pkgId = existing.id
      else {
        const [np] = await db
          .insert(packages)
          .values({ name: item.package_name, ecosystem: eco })
          .onConflictDoNothing()
          .returning()
        if (np) pkgId = np.id
        else {
          const [again] = await db
            .select()
            .from(packages)
            .where(and(eq(packages.name, item.package_name), eq(packages.ecosystem, eco)))
          pkgId = again?.id
        }
      }
    }
    if (!pkgId) continue

    const [created] = await db
      .insert(updates)
      .values({
        workspace_id: body.workspace_id,
        project_id: body.project_id,
        package_id: pkgId,
        from_version: item.from_version,
        to_version: item.to_version,
        ecosystem: eco,
        bump_type: item.bump_type ?? inferBumpType(item.from_version, item.to_version),
        source: body.source ?? 'import',
        source_pr_url: item.source_pr_url ?? null,
        status: 'pending',
        created_by: userId,
      })
      .returning()
    await gradeUpdate(created.id)
    createdIds.push(created.id)
  }

  const created = []
  for (const id of createdIds) {
    const d = await buildDetail(id)
    if (d) created.push(d)
  }
  return c.json({ created }, 201)
})

// DELETE /:id — auth — delete update and all derived rows.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(updates).where(eq(updates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.delete(risk_factors).where(eq(risk_factors.update_id, id))
  await db.delete(risk_scores).where(eq(risk_scores.update_id, id))
  await db.delete(script_diffs).where(eq(script_diffs.update_id, id))
  await db.delete(dependency_deltas).where(eq(dependency_deltas.update_id, id))
  await db.delete(updates).where(eq(updates.id, id))
  return c.json({ success: true })
})

// POST /:id/reevaluate — auth — recompute grade/factors/diffs.
router.post('/:id/reevaluate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(updates).where(eq(updates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.update(updates).set({ updated_at: new Date() }).where(eq(updates.id, id))
  await gradeUpdate(id)
  const detail = await buildDetail(id)
  return c.json(detail)
})

export { gradeUpdate, buildDetail, inferBumpType }
export default router
