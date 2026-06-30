import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ----------------------------------------------------------------------------
// Workspaces & membership
// ----------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  owner_id: text('owner_id').notNull(),
  default_ecosystem: text('default_ecosystem').default('npm').notNull(),
  default_policy_id: text('default_policy_id'),
  auto_clear_max_grade: text('auto_clear_max_grade').default('B').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').default('reviewer').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ----------------------------------------------------------------------------
// Projects & manifests
// ----------------------------------------------------------------------------

export const projects = pgTable('projects', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  ecosystem: text('ecosystem').default('npm').notNull(),
  repo_url: text('repo_url'),
  tags: jsonb('tags').$type<string[]>().default([]),
  dependency_count: integer('dependency_count').default(0).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const manifests = pgTable('manifests', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  project_id: text('project_id').notNull().references(() => projects.id),
  ecosystem: text('ecosystem').notNull(),
  filename: text('filename').notNull(),
  kind: text('kind').default('manifest').notNull(),
  content: text('content').notNull(),
  parsed: jsonb('parsed').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Package intelligence
// ----------------------------------------------------------------------------

export const packages = pgTable('packages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  ecosystem: text('ecosystem').notNull(),
  reputation_tier: text('reputation_tier').default('niche').notNull(),
  weekly_downloads: integer('weekly_downloads').default(0).notNull(),
  download_trend: real('download_trend').default(0).notNull(),
  star_count: integer('star_count').default(0).notNull(),
  contributor_count: integer('contributor_count').default(0).notNull(),
  repo_url: text('repo_url'),
  is_deprecated: boolean('is_deprecated').default(false).notNull(),
  is_archived: boolean('is_archived').default(false).notNull(),
  typosquat_suspect: boolean('typosquat_suspect').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.name, t.ecosystem)])

export const package_versions = pgTable('package_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  package_id: text('package_id').notNull().references(() => packages.id),
  version: text('version').notNull(),
  published_at: timestamp('published_at'),
  published_hour: integer('published_hour'),
  has_provenance: boolean('has_provenance').default(false).notNull(),
  signature_present: boolean('signature_present').default(false).notNull(),
  slsa_level: integer('slsa_level').default(0).notNull(),
  publisher_2fa: boolean('publisher_2fa').default(false).notNull(),
  install_scripts: jsonb('install_scripts').$type<Record<string, string>>().default({}),
  file_count: integer('file_count').default(0).notNull(),
  lines_added: integer('lines_added').default(0).notNull(),
  lines_removed: integer('lines_removed').default(0).notNull(),
  tarball_matches_repo: boolean('tarball_matches_repo').default(true).notNull(),
  dependencies: jsonb('dependencies').$type<Record<string, string>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.package_id, t.version)])

export const maintainers = pgTable('maintainers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  display_name: text('display_name'),
  account_created_at: timestamp('account_created_at'),
  packages_owned: integer('packages_owned').default(0).notNull(),
  trust_score: real('trust_score').default(50).notNull(),
  prior_incidents: integer('prior_incidents').default(0).notNull(),
  reputation: text('reputation').default('unknown').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const package_maintainers = pgTable('package_maintainers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  package_version_id: text('package_version_id').notNull().references(() => package_versions.id),
  maintainer_id: text('maintainer_id').notNull().references(() => maintainers.id),
  role: text('role').default('publisher').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.package_version_id, t.maintainer_id)])

export const dependencies = pgTable('dependencies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  project_id: text('project_id').notNull().references(() => projects.id),
  package_id: text('package_id').notNull().references(() => packages.id),
  current_version: text('current_version').notNull(),
  version_range: text('version_range'),
  is_direct: boolean('is_direct').default(true).notNull(),
  is_dev: boolean('is_dev').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.project_id, t.package_id)])

// ----------------------------------------------------------------------------
// Updates (bump PRs) & risk analysis
// ----------------------------------------------------------------------------

export const updates = pgTable('updates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  project_id: text('project_id').notNull().references(() => projects.id),
  package_id: text('package_id').notNull().references(() => packages.id),
  from_version: text('from_version').notNull(),
  to_version: text('to_version').notNull(),
  ecosystem: text('ecosystem').notNull(),
  bump_type: text('bump_type').default('patch').notNull(),
  source: text('source').default('manual').notNull(),
  source_pr_url: text('source_pr_url'),
  status: text('status').default('pending').notNull(),
  assigned_to: text('assigned_to'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const risk_scores = pgTable('risk_scores', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  update_id: text('update_id').notNull().references(() => updates.id).unique(),
  total_score: real('total_score').notNull(),
  grade: text('grade').notNull(),
  confidence: real('confidence').default(1).notNull(),
  breakdown: jsonb('breakdown').$type<Array<{ factor: string; raw: number; sub_score: number; weight: number; contribution: number }>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

export const risk_factors = pgTable('risk_factors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  update_id: text('update_id').notNull().references(() => updates.id),
  factor_type: text('factor_type').notNull(),
  raw_value: real('raw_value').default(0).notNull(),
  sub_score: real('sub_score').default(0).notNull(),
  weight: real('weight').default(0).notNull(),
  contribution: real('contribution').default(0).notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.update_id, t.factor_type)])

export const script_diffs = pgTable('script_diffs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  update_id: text('update_id').notNull().references(() => updates.id).unique(),
  added_scripts: jsonb('added_scripts').$type<Record<string, string>>().default({}),
  removed_scripts: jsonb('removed_scripts').$type<Record<string, string>>().default({}),
  changed_scripts: jsonb('changed_scripts').$type<Record<string, { from: string; to: string }>>().default({}),
  has_new_install_hook: boolean('has_new_install_hook').default(false).notNull(),
  fetches_remote: boolean('fetches_remote').default(false).notNull(),
  obfuscation_suspect: boolean('obfuscation_suspect').default(false).notNull(),
  native_build_hook: boolean('native_build_hook').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const dependency_deltas = pgTable('dependency_deltas', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  update_id: text('update_id').notNull().references(() => updates.id).unique(),
  added: jsonb('added').$type<Array<{ name: string; version: string }>>().default([]),
  removed: jsonb('removed').$type<Array<{ name: string; version: string }>>().default([]),
  range_widened: jsonb('range_widened').$type<Array<{ name: string; from: string; to: string }>>().default([]),
  blast_radius: integer('blast_radius').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Policies & evaluation
// ----------------------------------------------------------------------------

export const policies = pgTable('policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  weights: jsonb('weights').$type<Record<string, number>>().default({}),
  grade_bands: jsonb('grade_bands').$type<Record<string, number>>().default({}),
  auto_clear_max_grade: text('auto_clear_max_grade').default('B').notNull(),
  is_default: boolean('is_default').default(false).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const policy_rules = pgTable('policy_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  policy_id: text('policy_id').notNull().references(() => policies.id),
  rule_type: text('rule_type').notNull(),
  threshold: text('threshold'),
  action: text('action').default('block').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const policy_evaluations = pgTable('policy_evaluations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  update_id: text('update_id').notNull().references(() => updates.id),
  policy_id: text('policy_id').notNull().references(() => policies.id),
  rule_type: text('rule_type').notNull(),
  passed: boolean('passed').notNull(),
  message: text('message').default('').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Pinning advice
// ----------------------------------------------------------------------------

export const pinning_advice = pgTable('pinning_advice', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  project_id: text('project_id').notNull().references(() => projects.id),
  package_id: text('package_id').notNull().references(() => packages.id),
  recommendation: text('recommendation').notNull(),
  suggested_version: text('suggested_version'),
  rationale: text('rationale').default('').notNull(),
  patch_snippet: text('patch_snippet'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Decision ledger (append-only, hash chain)
// ----------------------------------------------------------------------------

export const ledger_entries = pgTable('ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  update_id: text('update_id').notNull().references(() => updates.id),
  decision: text('decision').notNull(),
  grade_at_decision: text('grade_at_decision').notNull(),
  score_at_decision: real('score_at_decision').default(0).notNull(),
  actor_id: text('actor_id').notNull(),
  justification: text('justification').default('').notNull(),
  policy_result: jsonb('policy_result').$type<Record<string, unknown>>().default({}),
  factors_snapshot: jsonb('factors_snapshot').$type<Record<string, unknown>>().default({}),
  prev_hash: text('prev_hash').default('').notNull(),
  entry_hash: text('entry_hash').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Known-incident replay library
// ----------------------------------------------------------------------------

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ecosystem: text('ecosystem').notNull(),
  package_name: text('package_name').notNull(),
  from_version: text('from_version').notNull(),
  to_version: text('to_version').notNull(),
  year: integer('year'),
  summary: text('summary').default('').notNull(),
  catching_factor: text('catching_factor').notNull(),
  expected_grade: text('expected_grade').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Alerts & notifications
// ----------------------------------------------------------------------------

export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  trigger_type: text('trigger_type').notNull(),
  threshold: text('threshold'),
  channel: text('channel').default('in_app').notNull(),
  webhook_url: text('webhook_url'),
  enabled: boolean('enabled').default(true).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  alert_rule_id: text('alert_rule_id').references(() => alert_rules.id),
  update_id: text('update_id').references(() => updates.id),
  severity: text('severity').default('info').notNull(),
  title: text('title').notNull(),
  message: text('message').default('').notNull(),
  is_resolved: boolean('is_resolved').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  type: text('type').default('info').notNull(),
  title: text('title').notNull(),
  body: text('body').default('').notNull(),
  link: text('link'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Reports
// ----------------------------------------------------------------------------

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  data: jsonb('data').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Webhooks & deliveries
// ----------------------------------------------------------------------------

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  url: text('url').notNull(),
  event_types: jsonb('event_types').$type<string[]>().default([]),
  secret: text('secret'),
  enabled: boolean('enabled').default(true).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const webhook_deliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  webhook_id: text('webhook_id').notNull().references(() => webhooks.id),
  event_type: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  status: text('status').default('pending').notNull(),
  status_code: integer('status_code'),
  attempt: integer('attempt').default(1).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Billing
// ----------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
