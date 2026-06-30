import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  projects,
  packages,
  package_versions,
  maintainers,
  package_maintainers,
  dependencies,
  policies,
  policy_rules,
  updates,
  risk_scores,
  risk_factors,
  incidents,
} from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import membersRoutes from './routes/members.js'
import projectsRoutes from './routes/projects.js'
import manifestsRoutes from './routes/manifests.js'
import packagesRoutes from './routes/packages.js'
import maintainersRoutes from './routes/maintainers.js'
import updatesRoutes from './routes/updates.js'
import riskRoutes from './routes/risk.js'
import scriptDiffsRoutes from './routes/script-diffs.js'
import dependencyDeltasRoutes from './routes/dependency-deltas.js'
import queueRoutes from './routes/queue.js'
import policiesRoutes from './routes/policies.js'
import policyRulesRoutes from './routes/policy-rules.js'
import policyEvaluationsRoutes from './routes/policy-evaluations.js'
import pinningRoutes from './routes/pinning.js'
import ledgerRoutes from './routes/ledger.js'
import incidentsRoutes from './routes/incidents.js'
import rulesRoutes from './routes/rules.js'
import alertsRoutes from './routes/alerts.js'
import alertRulesRoutes from './routes/alert-rules.js'
import notificationsRoutes from './routes/notifications.js'
import dashboardRoutes from './routes/dashboard.js'
import reportsRoutes from './routes/reports.js'
import webhooksRoutes from './routes/webhooks.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://dependency-update-risk-grader.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

// ----------------------------------------------------------------------------
// API router — everything mounts under /api/v1 via a child Hono instance.
// ----------------------------------------------------------------------------

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/members', membersRoutes)
api.route('/projects', projectsRoutes)
api.route('/manifests', manifestsRoutes)
api.route('/packages', packagesRoutes)
api.route('/maintainers', maintainersRoutes)
api.route('/updates', updatesRoutes)
api.route('/risk', riskRoutes)
api.route('/script-diffs', scriptDiffsRoutes)
api.route('/dependency-deltas', dependencyDeltasRoutes)
api.route('/queue', queueRoutes)
api.route('/policies', policiesRoutes)
api.route('/policy-rules', policyRulesRoutes)
api.route('/policy-evaluations', policyEvaluationsRoutes)
api.route('/pinning', pinningRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/incidents', incidentsRoutes)
api.route('/rules', rulesRoutes)
api.route('/alerts', alertsRoutes)
api.route('/alert-rules', alertRulesRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/reports', reportsRoutes)
api.route('/webhooks', webhooksRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ----------------------------------------------------------------------------
// Idempotent seed — count-then-insert. Safe to run on every boot.
// ----------------------------------------------------------------------------

async function seedIfEmpty() {
  // Plans (always ensure the two tiers exist).
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db
      .insert(plans)
      .values([
        { id: 'free', name: 'Free', price_cents: 0 },
        { id: 'pro', name: 'Pro', price_cents: 2900 },
      ])
      .onConflictDoNothing()
    console.log('Seeded plans')
  }

  // Demo workspace + sample intelligence data.
  const existingWs = await db.select().from(workspaces).limit(1)
  if (existingWs.length > 0) return

  const demoOwner = 'demo-user'

  // Default policy first (so we can point the workspace at it).
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: 'Demo Workspace',
      slug: 'demo',
      owner_id: demoOwner,
      default_ecosystem: 'npm',
      auto_clear_max_grade: 'B',
    })
    .returning()

  await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: demoOwner, role: 'owner' })
    .onConflictDoNothing()

  const defaultWeights = {
    maintainer_change: 0.2,
    install_scripts: 0.2,
    publish_cadence: 0.1,
    provenance: 0.15,
    blast_radius: 0.15,
    version_jump: 0.1,
    reputation: 0.1,
  }
  const defaultBands = { A: 20, B: 40, C: 60, D: 80, F: 100 }

  const [policy] = await db
    .insert(policies)
    .values({
      workspace_id: ws.id,
      name: 'Default Policy',
      description: 'Balanced default risk weighting',
      weights: defaultWeights,
      grade_bands: defaultBands,
      auto_clear_max_grade: 'B',
      is_default: true,
      created_by: demoOwner,
    })
    .returning()

  await db
    .update(workspaces)
    .set({ default_policy_id: policy.id })
    .where(eq(workspaces.id, ws.id))

  await db.insert(policy_rules).values([
    {
      policy_id: policy.id,
      rule_type: 'block_new_install_hook',
      threshold: 'true',
      action: 'block',
      enabled: true,
      config: {},
    },
    {
      policy_id: policy.id,
      rule_type: 'min_grade',
      threshold: 'C',
      action: 'needs_review',
      enabled: true,
      config: {},
    },
  ])

  // Sample project.
  const [project] = await db
    .insert(projects)
    .values({
      workspace_id: ws.id,
      name: 'web-api',
      ecosystem: 'npm',
      repo_url: 'https://github.com/demo/web-api',
      tags: ['production', 'node'],
      dependency_count: 2,
      created_by: demoOwner,
    })
    .returning()

  // Sample packages + versions + maintainers.
  const [pkgLeftpad] = await db
    .insert(packages)
    .values({
      name: 'left-pad',
      ecosystem: 'npm',
      reputation_tier: 'popular',
      weekly_downloads: 2_500_000,
      download_trend: 0.05,
      star_count: 1100,
      contributor_count: 12,
      repo_url: 'https://github.com/demo/left-pad',
    })
    .returning()

  const [pkgColor] = await db
    .insert(packages)
    .values({
      name: 'color-utils',
      ecosystem: 'npm',
      reputation_tier: 'niche',
      weekly_downloads: 4200,
      download_trend: -0.1,
      star_count: 34,
      contributor_count: 1,
      repo_url: 'https://github.com/demo/color-utils',
    })
    .returning()

  const [maintAlice] = await db
    .insert(maintainers)
    .values({
      username: 'alice',
      display_name: 'Alice Dev',
      packages_owned: 8,
      trust_score: 82,
      prior_incidents: 0,
      reputation: 'trusted',
    })
    .returning()

  const [maintNew] = await db
    .insert(maintainers)
    .values({
      username: 'newcomer42',
      display_name: 'New Maintainer',
      packages_owned: 1,
      trust_score: 18,
      prior_incidents: 1,
      reputation: 'unknown',
    })
    .returning()

  const [verLeftOld] = await db
    .insert(package_versions)
    .values({
      package_id: pkgLeftpad.id,
      version: '1.3.0',
      published_at: new Date('2024-01-10T12:00:00Z'),
      published_hour: 12,
      has_provenance: true,
      signature_present: true,
      slsa_level: 3,
      publisher_2fa: true,
      install_scripts: {},
      file_count: 8,
      lines_added: 20,
      lines_removed: 5,
      tarball_matches_repo: true,
      dependencies: {},
    })
    .returning()

  const [verLeftNew] = await db
    .insert(package_versions)
    .values({
      package_id: pkgLeftpad.id,
      version: '1.4.0',
      published_at: new Date('2024-06-01T03:00:00Z'),
      published_hour: 3,
      has_provenance: true,
      signature_present: true,
      slsa_level: 3,
      publisher_2fa: true,
      install_scripts: {},
      file_count: 9,
      lines_added: 40,
      lines_removed: 10,
      tarball_matches_repo: true,
      dependencies: {},
    })
    .returning()

  const [verColorOld] = await db
    .insert(package_versions)
    .values({
      package_id: pkgColor.id,
      version: '2.0.1',
      published_at: new Date('2024-02-15T09:00:00Z'),
      published_hour: 9,
      has_provenance: false,
      signature_present: false,
      slsa_level: 0,
      publisher_2fa: false,
      install_scripts: {},
      file_count: 12,
      lines_added: 10,
      lines_removed: 2,
      tarball_matches_repo: true,
      dependencies: {},
    })
    .returning()

  const [verColorNew] = await db
    .insert(package_versions)
    .values({
      package_id: pkgColor.id,
      version: '3.0.0',
      published_at: new Date('2024-06-20T02:30:00Z'),
      published_hour: 2,
      has_provenance: false,
      signature_present: false,
      slsa_level: 0,
      publisher_2fa: false,
      install_scripts: { postinstall: 'node ./scripts/setup.js' },
      file_count: 31,
      lines_added: 900,
      lines_removed: 40,
      tarball_matches_repo: false,
      dependencies: { 'node-fetch': '^3.0.0' },
    })
    .returning()

  await db
    .insert(package_maintainers)
    .values([
      { package_version_id: verLeftOld.id, maintainer_id: maintAlice.id, role: 'publisher' },
      { package_version_id: verLeftNew.id, maintainer_id: maintAlice.id, role: 'publisher' },
      { package_version_id: verColorOld.id, maintainer_id: maintAlice.id, role: 'publisher' },
      { package_version_id: verColorNew.id, maintainer_id: maintNew.id, role: 'publisher' },
    ])
    .onConflictDoNothing()

  await db
    .insert(dependencies)
    .values([
      {
        project_id: project.id,
        package_id: pkgLeftpad.id,
        current_version: '1.3.0',
        version_range: '^1.3.0',
        is_direct: true,
        is_dev: false,
      },
      {
        project_id: project.id,
        package_id: pkgColor.id,
        current_version: '2.0.1',
        version_range: '^2.0.0',
        is_direct: true,
        is_dev: false,
      },
    ])
    .onConflictDoNothing()

  // Two sample updates: one low-risk (left-pad), one high-risk (color-utils).
  const [lowUpdate] = await db
    .insert(updates)
    .values({
      workspace_id: ws.id,
      project_id: project.id,
      package_id: pkgLeftpad.id,
      from_version: '1.3.0',
      to_version: '1.4.0',
      ecosystem: 'npm',
      bump_type: 'minor',
      source: 'dependabot',
      status: 'pending',
      created_by: demoOwner,
    })
    .returning()

  const [highUpdate] = await db
    .insert(updates)
    .values({
      workspace_id: ws.id,
      project_id: project.id,
      package_id: pkgColor.id,
      from_version: '2.0.1',
      to_version: '3.0.0',
      ecosystem: 'npm',
      bump_type: 'major',
      source: 'renovate',
      status: 'pending',
      created_by: demoOwner,
    })
    .returning()

  await db
    .insert(risk_scores)
    .values([
      {
        update_id: lowUpdate.id,
        total_score: 14,
        grade: 'A',
        confidence: 0.95,
        breakdown: [
          { factor: 'maintainer_change', raw: 0, sub_score: 0, weight: 0.2, contribution: 0 },
          { factor: 'install_scripts', raw: 0, sub_score: 0, weight: 0.2, contribution: 0 },
        ],
      },
      {
        update_id: highUpdate.id,
        total_score: 78,
        grade: 'D',
        confidence: 0.9,
        breakdown: [
          {
            factor: 'maintainer_change',
            raw: 1,
            sub_score: 90,
            weight: 0.2,
            contribution: 18,
          },
          {
            factor: 'install_scripts',
            raw: 1,
            sub_score: 95,
            weight: 0.2,
            contribution: 19,
          },
        ],
      },
    ])
    .onConflictDoNothing()

  await db
    .insert(risk_factors)
    .values([
      {
        update_id: highUpdate.id,
        factor_type: 'maintainer_change',
        raw_value: 1,
        sub_score: 90,
        weight: 0.2,
        contribution: 18,
        detail: { from: 'alice', to: 'newcomer42' },
      },
      {
        update_id: highUpdate.id,
        factor_type: 'install_scripts',
        raw_value: 1,
        sub_score: 95,
        weight: 0.2,
        contribution: 19,
        detail: { added: ['postinstall'] },
      },
    ])
    .onConflictDoNothing()

  // Known-incident replay library.
  await db
    .insert(incidents)
    .values([
      {
        slug: 'event-stream-2018',
        name: 'event-stream / flatmap-stream',
        ecosystem: 'npm',
        package_name: 'event-stream',
        from_version: '3.3.5',
        to_version: '3.3.6',
        year: 2018,
        summary: 'Malicious flatmap-stream dependency added by a new maintainer.',
        catching_factor: 'maintainer_change',
        expected_grade: 'F',
        details: {},
      },
      {
        slug: 'ua-parser-js-2021',
        name: 'ua-parser-js compromise',
        ecosystem: 'npm',
        package_name: 'ua-parser-js',
        from_version: '0.7.28',
        to_version: '0.7.29',
        year: 2021,
        summary: 'Hijacked publish added install-time cryptominer + password stealer.',
        catching_factor: 'install_scripts',
        expected_grade: 'F',
        details: {},
      },
      {
        slug: 'colors-2022',
        name: 'colors.js sabotage',
        ecosystem: 'npm',
        package_name: 'colors',
        from_version: '1.4.0',
        to_version: '1.4.1',
        year: 2022,
        summary: 'Maintainer intentionally shipped an infinite loop.',
        catching_factor: 'publish_cadence',
        expected_grade: 'D',
        details: {},
      },
    ])
    .onConflictDoNothing()

  console.log('Seeded demo workspace and intelligence data')
}

// ----------------------------------------------------------------------------
// Boot order: bind the port FIRST so the platform health check sees a live
// service immediately. migrate() + seedIfEmpty() run AFTER serve(), each in its
// own try/catch (both idempotent) so a cold/slow DB never blocks port binding.
// ----------------------------------------------------------------------------

const port = parseInt(process.env.PORT ?? '3001')
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

try {
  await migrate()
  console.log('Migration complete')
} catch (e) {
  console.error('Migration error:', e)
}

try {
  await seedIfEmpty()
} catch (e) {
  console.error('Seed error:', e)
}

export default app
