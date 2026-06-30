import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  // --- workspaces & membership ---
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    owner_id text NOT NULL,
    default_ecosystem text NOT NULL DEFAULT 'npm',
    default_policy_id text,
    auto_clear_max_grade text NOT NULL DEFAULT 'B',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'reviewer',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  // --- projects & manifests ---
  `CREATE TABLE IF NOT EXISTS projects (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    ecosystem text NOT NULL DEFAULT 'npm',
    repo_url text,
    tags jsonb DEFAULT '[]'::jsonb,
    dependency_count integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS manifests (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id),
    ecosystem text NOT NULL,
    filename text NOT NULL,
    kind text NOT NULL DEFAULT 'manifest',
    content text NOT NULL,
    parsed jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- package intelligence ---
  `CREATE TABLE IF NOT EXISTS packages (
    id text PRIMARY KEY,
    name text NOT NULL,
    ecosystem text NOT NULL,
    reputation_tier text NOT NULL DEFAULT 'niche',
    weekly_downloads integer NOT NULL DEFAULT 0,
    download_trend real NOT NULL DEFAULT 0,
    star_count integer NOT NULL DEFAULT 0,
    contributor_count integer NOT NULL DEFAULT 0,
    repo_url text,
    is_deprecated boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    typosquat_suspect boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, ecosystem)
  )`,
  `CREATE TABLE IF NOT EXISTS package_versions (
    id text PRIMARY KEY,
    package_id text NOT NULL REFERENCES packages(id),
    version text NOT NULL,
    published_at timestamptz,
    published_hour integer,
    has_provenance boolean NOT NULL DEFAULT false,
    signature_present boolean NOT NULL DEFAULT false,
    slsa_level integer NOT NULL DEFAULT 0,
    publisher_2fa boolean NOT NULL DEFAULT false,
    install_scripts jsonb DEFAULT '{}'::jsonb,
    file_count integer NOT NULL DEFAULT 0,
    lines_added integer NOT NULL DEFAULT 0,
    lines_removed integer NOT NULL DEFAULT 0,
    tarball_matches_repo boolean NOT NULL DEFAULT true,
    dependencies jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (package_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS maintainers (
    id text PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text,
    account_created_at timestamptz,
    packages_owned integer NOT NULL DEFAULT 0,
    trust_score real NOT NULL DEFAULT 50,
    prior_incidents integer NOT NULL DEFAULT 0,
    reputation text NOT NULL DEFAULT 'unknown',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS package_maintainers (
    id text PRIMARY KEY,
    package_version_id text NOT NULL REFERENCES package_versions(id),
    maintainer_id text NOT NULL REFERENCES maintainers(id),
    role text NOT NULL DEFAULT 'publisher',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (package_version_id, maintainer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dependencies (
    id text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id),
    package_id text NOT NULL REFERENCES packages(id),
    current_version text NOT NULL,
    version_range text,
    is_direct boolean NOT NULL DEFAULT true,
    is_dev boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, package_id)
  )`,

  // --- updates & risk analysis ---
  `CREATE TABLE IF NOT EXISTS updates (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    project_id text NOT NULL REFERENCES projects(id),
    package_id text NOT NULL REFERENCES packages(id),
    from_version text NOT NULL,
    to_version text NOT NULL,
    ecosystem text NOT NULL,
    bump_type text NOT NULL DEFAULT 'patch',
    source text NOT NULL DEFAULT 'manual',
    source_pr_url text,
    status text NOT NULL DEFAULT 'pending',
    assigned_to text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS risk_scores (
    id text PRIMARY KEY,
    update_id text NOT NULL UNIQUE REFERENCES updates(id),
    total_score real NOT NULL,
    grade text NOT NULL,
    confidence real NOT NULL DEFAULT 1,
    breakdown jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS risk_factors (
    id text PRIMARY KEY,
    update_id text NOT NULL REFERENCES updates(id),
    factor_type text NOT NULL,
    raw_value real NOT NULL DEFAULT 0,
    sub_score real NOT NULL DEFAULT 0,
    weight real NOT NULL DEFAULT 0,
    contribution real NOT NULL DEFAULT 0,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (update_id, factor_type)
  )`,
  `CREATE TABLE IF NOT EXISTS script_diffs (
    id text PRIMARY KEY,
    update_id text NOT NULL UNIQUE REFERENCES updates(id),
    added_scripts jsonb DEFAULT '{}'::jsonb,
    removed_scripts jsonb DEFAULT '{}'::jsonb,
    changed_scripts jsonb DEFAULT '{}'::jsonb,
    has_new_install_hook boolean NOT NULL DEFAULT false,
    fetches_remote boolean NOT NULL DEFAULT false,
    obfuscation_suspect boolean NOT NULL DEFAULT false,
    native_build_hook boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS dependency_deltas (
    id text PRIMARY KEY,
    update_id text NOT NULL UNIQUE REFERENCES updates(id),
    added jsonb DEFAULT '[]'::jsonb,
    removed jsonb DEFAULT '[]'::jsonb,
    range_widened jsonb DEFAULT '[]'::jsonb,
    blast_radius integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- policies & evaluation ---
  `CREATE TABLE IF NOT EXISTS policies (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    weights jsonb DEFAULT '{}'::jsonb,
    grade_bands jsonb DEFAULT '{}'::jsonb,
    auto_clear_max_grade text NOT NULL DEFAULT 'B',
    is_default boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS policy_rules (
    id text PRIMARY KEY,
    policy_id text NOT NULL REFERENCES policies(id),
    rule_type text NOT NULL,
    threshold text,
    action text NOT NULL DEFAULT 'block',
    enabled boolean NOT NULL DEFAULT true,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS policy_evaluations (
    id text PRIMARY KEY,
    update_id text NOT NULL REFERENCES updates(id),
    policy_id text NOT NULL REFERENCES policies(id),
    rule_type text NOT NULL,
    passed boolean NOT NULL,
    message text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- pinning advice ---
  `CREATE TABLE IF NOT EXISTS pinning_advice (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    project_id text NOT NULL REFERENCES projects(id),
    package_id text NOT NULL REFERENCES packages(id),
    recommendation text NOT NULL,
    suggested_version text,
    rationale text NOT NULL DEFAULT '',
    patch_snippet text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- decision ledger ---
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    update_id text NOT NULL REFERENCES updates(id),
    decision text NOT NULL,
    grade_at_decision text NOT NULL,
    score_at_decision real NOT NULL DEFAULT 0,
    actor_id text NOT NULL,
    justification text NOT NULL DEFAULT '',
    policy_result jsonb DEFAULT '{}'::jsonb,
    factors_snapshot jsonb DEFAULT '{}'::jsonb,
    prev_hash text NOT NULL DEFAULT '',
    entry_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- known-incident replay ---
  `CREATE TABLE IF NOT EXISTS incidents (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    ecosystem text NOT NULL,
    package_name text NOT NULL,
    from_version text NOT NULL,
    to_version text NOT NULL,
    year integer,
    summary text NOT NULL DEFAULT '',
    catching_factor text NOT NULL,
    expected_grade text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- alerts & notifications ---
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    trigger_type text NOT NULL,
    threshold text,
    channel text NOT NULL DEFAULT 'in_app',
    webhook_url text,
    enabled boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    alert_rule_id text REFERENCES alert_rules(id),
    update_id text REFERENCES updates(id),
    severity text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    message text NOT NULL DEFAULT '',
    is_resolved boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text REFERENCES workspaces(id),
    type text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- reports ---
  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    type text NOT NULL,
    title text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb,
    data jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- webhooks & deliveries ---
  `CREATE TABLE IF NOT EXISTS webhooks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    url text NOT NULL,
    event_types jsonb DEFAULT '[]'::jsonb,
    secret text,
    enabled boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id text PRIMARY KEY,
    webhook_id text NOT NULL REFERENCES webhooks(id),
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending',
    status_code integer,
    attempt integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- billing ---
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --- indexes on FKs / workspace_id ---
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_manifests_project ON manifests(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_package_versions_package ON package_versions(package_id)`,
  `CREATE INDEX IF NOT EXISTS idx_package_maintainers_version ON package_maintainers(package_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_package_maintainers_maintainer ON package_maintainers(maintainer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dependencies_project ON dependencies(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dependencies_package ON dependencies(package_id)`,
  `CREATE INDEX IF NOT EXISTS idx_updates_workspace ON updates(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_updates_project ON updates(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_updates_package ON updates(package_id)`,
  `CREATE INDEX IF NOT EXISTS idx_updates_status ON updates(status)`,
  `CREATE INDEX IF NOT EXISTS idx_risk_factors_update ON risk_factors(update_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policies_workspace ON policies(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_rules_policy ON policy_rules(policy_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policy_evaluations_update ON policy_evaluations(update_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pinning_advice_workspace ON pinning_advice(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pinning_advice_project ON pinning_advice(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_entries_workspace ON ledger_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_entries_update ON ledger_entries(update_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace ON alert_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} statements`)
}
