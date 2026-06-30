# DependencyUpdateRiskGrader — Authoritative Build Contract

This is the single source of truth. Every agent follows it exactly. Filenames, mount
paths, api method names, and page files declared here are BINDING.

Stack: Hono backend (`backend/`, mounted under `/api/v1` via child Hono `api` router),
Next.js 16 frontend (`web/`), Neon Postgres + drizzle-orm, Neon Auth.
Backend trusts `X-User-Id` header; use `getUserId(c)` everywhere. Public reads /
auth-gated writes with zod validation + ownership checks. Frontend calls
`fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. All features FREE
(billing optional, Stripe -> 503).

---

## (a) Tables (columns summarized; authoritative definition in `backend/src/db/schema.ts`)

- **workspaces** — id, name, slug(unique), owner_id, default_ecosystem, default_policy_id, auto_clear_max_grade, created_at, updated_at
- **workspace_members** — id, workspace_id(fk), user_id, role, created_at; UNIQUE(workspace_id,user_id)
- **projects** — id, workspace_id(fk), name, ecosystem, repo_url, tags(jsonb), dependency_count, created_by, created_at, updated_at
- **manifests** — id, project_id(fk), ecosystem, filename, kind, content, parsed(jsonb), created_at
- **packages** — id, name, ecosystem, reputation_tier, weekly_downloads, download_trend(real), star_count, contributor_count, repo_url, is_deprecated, is_archived, typosquat_suspect, created_at; UNIQUE(name,ecosystem)
- **package_versions** — id, package_id(fk), version, published_at, published_hour, has_provenance, signature_present, slsa_level, publisher_2fa, install_scripts(jsonb), file_count, lines_added, lines_removed, tarball_matches_repo, dependencies(jsonb), created_at; UNIQUE(package_id,version)
- **maintainers** — id, username(unique), display_name, account_created_at, packages_owned, trust_score(real), prior_incidents, reputation, created_at
- **package_maintainers** — id, package_version_id(fk), maintainer_id(fk), role, created_at; UNIQUE(package_version_id,maintainer_id)
- **dependencies** — id, project_id(fk), package_id(fk), current_version, version_range, is_direct, is_dev, created_at; UNIQUE(project_id,package_id)
- **updates** — id, workspace_id(fk), project_id(fk), package_id(fk), from_version, to_version, ecosystem, bump_type, source, source_pr_url, status, assigned_to, created_by, created_at, updated_at
- **risk_scores** — id, update_id(fk,unique), total_score(real), grade, confidence(real), breakdown(jsonb), computed_at
- **risk_factors** — id, update_id(fk), factor_type, raw_value(real), sub_score(real), weight(real), contribution(real), detail(jsonb), created_at; UNIQUE(update_id,factor_type)
- **script_diffs** — id, update_id(fk,unique), added_scripts(jsonb), removed_scripts(jsonb), changed_scripts(jsonb), has_new_install_hook, fetches_remote, obfuscation_suspect, native_build_hook, created_at
- **dependency_deltas** — id, update_id(fk,unique), added(jsonb), removed(jsonb), range_widened(jsonb), blast_radius, created_at
- **policies** — id, workspace_id(fk), name, description, weights(jsonb), grade_bands(jsonb), auto_clear_max_grade, is_default, created_by, created_at, updated_at
- **policy_rules** — id, policy_id(fk), rule_type, threshold, action, enabled, config(jsonb), created_at
- **policy_evaluations** — id, update_id(fk), policy_id(fk), rule_type, passed, message, created_at
- **pinning_advice** — id, workspace_id(fk), project_id(fk), package_id(fk), recommendation, suggested_version, rationale, patch_snippet, created_at
- **ledger_entries** — id, workspace_id(fk), update_id(fk), decision, grade_at_decision, score_at_decision(real), actor_id, justification, policy_result(jsonb), factors_snapshot(jsonb), prev_hash, entry_hash, created_at
- **incidents** — id, slug(unique), name, ecosystem, package_name, from_version, to_version, year, summary, catching_factor, expected_grade, details(jsonb), created_at
- **alert_rules** — id, workspace_id(fk), name, trigger_type, threshold, channel, webhook_url, enabled, created_by, created_at
- **alerts** — id, workspace_id(fk), alert_rule_id(fk), update_id(fk), severity, title, message, is_resolved, created_at
- **notifications** — id, user_id, workspace_id(fk), type, title, body, link, is_read, created_at
- **reports** — id, workspace_id(fk), type, title, params(jsonb), data(jsonb), created_by, created_at
- **webhooks** — id, workspace_id(fk), name, url, event_types(jsonb), secret, enabled, created_by, created_at
- **webhook_deliveries** — id, webhook_id(fk), event_type, payload(jsonb), status, status_code, attempt, created_at
- **plans** — id(text PK 'free'/'pro'), name, price_cents
- **subscriptions** — id, user_id(unique), plan_id(fk text), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mounted under `/api/v1` in `index.ts` via `api.route(...)`)

Auth convention: public reads (no auth) unless noted; writes require `authMiddleware`
and ownership checks via workspace membership. Every file `export default router`.

### 1. `workspaces.ts` — mount `workspaces`
- `GET /` — auth — list workspaces the user owns/belongs to — `Workspace[]`
- `GET /:id` — public — workspace detail — `Workspace`
- `POST /` — auth — create workspace (auto-add owner as member, seed default policy) — `Workspace`
- `PUT /:id` — auth(owner) — update workspace settings — `Workspace`
- `DELETE /:id` — auth(owner) — delete workspace — `{success}`
- `POST /:id/reseed` — auth(owner) — reseed sample data for this workspace — `{success}`

### 2. `members.ts` — mount `members`
- `GET /` — auth — `?workspace_id=` list members — `Member[]`
- `POST /` — auth — add member (user_id, role) — `Member`
- `PUT /:id` — auth — change role — `Member`
- `DELETE /:id` — auth — remove member — `{success}`

### 3. `projects.ts` — mount `projects`
- `GET /` — public — `?workspace_id=` list projects — `Project[]`
- `GET /:id` — public — project detail (with dependency_count) — `Project`
- `POST /` — auth — create project — `Project`
- `PUT /:id` — auth — update project — `Project`
- `DELETE /:id` — auth — delete project — `{success}`
- `GET /:id/dependencies` — public — inventory for project — `Dependency[]`
- `GET /:id/summary` — public — risk posture summary for project — `{counts,grades}`

### 4. `manifests.ts` — mount `manifests`
- `GET /` — public — `?project_id=` list manifests — `Manifest[]`
- `GET /:id` — public — manifest detail (raw + parsed) — `Manifest`
- `POST /` — auth — upload+parse manifest (creates packages+dependencies rows) — `Manifest`
- `DELETE /:id` — auth — delete manifest — `{success}`

### 5. `packages.ts` — mount `packages`
- `GET /` — public — `?ecosystem=&q=` list packages — `Package[]`
- `GET /:id` — public — package profile (with versions, maintainers, cadence) — `PackageProfile`
- `GET /:id/versions` — public — version history with grades — `PackageVersion[]`
- `GET /:id/maintainers` — public — maintainer timeline — `Maintainer[]`

### 6. `maintainers.ts` — mount `maintainers`
- `GET /` — public — `?q=` list maintainers + trust scores — `Maintainer[]`
- `GET /:id` — public — maintainer detail + owned packages — `MaintainerProfile`

### 7. `updates.ts` — mount `updates`
- `GET /` — public — `?workspace_id=&status=&project_id=` list updates (joined grade) — `Update[]`
- `GET /:id` — public — update detail (joins package/project/grade) — `UpdateDetail`
- `POST /` — auth — create a bump-PR update (triggers grading) — `UpdateDetail`
- `POST /import` — auth — bulk import Dependabot/Renovate JSON payload — `{created:Update[]}`
- `DELETE /:id` — auth — delete update — `{success}`
- `POST /:id/reevaluate` — auth — recompute grade/factors/diffs — `UpdateDetail`

### 8. `risk.ts` — mount `risk`
- `GET /:updateId` — public — risk score + factor breakdown for an update — `{score,factors}`
- `GET /:updateId/factors` — public — per-factor rows — `RiskFactor[]`

### 9. `script-diffs.ts` — mount `script-diffs`
- `GET /:updateId` — public — lifecycle-script diff for an update — `ScriptDiff`

### 10. `dependency-deltas.ts` — mount `dependency-deltas`
- `GET /:updateId` — public — dependency delta for an update — `DependencyDelta`

### 11. `queue.ts` — mount `queue`
- `GET /` — public — `?workspace_id=` board grouped by status (ranked by grade) — `{columns}`
- `POST /:updateId/transition` — auth — change status (approve/reject/needs_review/block) writes ledger entry — `Update`
- `POST /bulk` — auth — bulk status transition `{ids,status,justification}` — `{updated:number}`
- `POST /auto-clear` — auth — `?workspace_id=` auto-clear all updates <= threshold — `{cleared:number}`
- `POST /:updateId/assign` — auth — assign reviewer — `Update`

### 12. `policies.ts` — mount `policies`
- `GET /` — public — `?workspace_id=` list policies — `Policy[]`
- `GET /:id` — public — policy detail with rules — `PolicyDetail`
- `POST /` — auth — create policy — `Policy`
- `PUT /:id` — auth — update policy (weights/bands/auto_clear) — `Policy`
- `DELETE /:id` — auth — delete policy — `{success}`
- `POST /:id/simulate` — auth — dry-run policy over historical updates — `{results}`

### 13. `policy-rules.ts` — mount `policy-rules`
- `GET /` — public — `?policy_id=` list rules — `PolicyRule[]`
- `POST /` — auth — add rule to policy — `PolicyRule`
- `PUT /:id` — auth — update rule — `PolicyRule`
- `DELETE /:id` — auth — delete rule — `{success}`

### 14. `policy-evaluations.ts` — mount `policy-evaluations`
- `GET /:updateId` — public — rule pass/fail results for an update — `PolicyEvaluation[]`
- `POST /:updateId/run` — auth — evaluate update against workspace default policy — `PolicyEvaluation[]`

### 15. `pinning.ts` — mount `pinning`
- `GET /` — public — `?workspace_id=&project_id=` list pinning advice — `PinningAdvice[]`
- `POST /generate` — auth — generate advice for a project — `{advice:PinningAdvice[]}`

### 16. `ledger.ts` — mount `ledger`
- `GET /` — public — `?workspace_id=&package=&actor=` list ledger entries — `LedgerEntry[]`
- `GET /:id` — public — ledger entry detail (factors snapshot) — `LedgerEntry`
- `GET /export` — public — `?workspace_id=&format=` export ledger — `{csv|json}`
- `GET /verify` — public — `?workspace_id=` verify hash chain integrity — `{valid,broken_at}`

### 17. `incidents.ts` — mount `incidents`
- `GET /` — public — list known-incident replays — `Incident[]`
- `GET /:id` — public — incident detail — `Incident`
- `POST /:id/replay` — auth — `{workspace_id}` create a graded update from the incident — `UpdateDetail`

### 18. `rules.ts` — mount `rules`
- `GET /` — public — `?workspace_id=` current risk weights + grade bands (from default policy) — `{weights,grade_bands,auto_clear_max_grade}`
- `PUT /` — auth — update weights/bands/auto-clear on default policy + live re-score preview — `{weights,grade_bands,preview}`
- `POST /reset` — auth — reset weights to defaults — `{weights,grade_bands}`

### 19. `alerts.ts` — mount `alerts`
- `GET /` — public — `?workspace_id=` list alerts — `Alert[]`
- `POST /:id/resolve` — auth — mark alert resolved — `Alert`

### 20. `alert-rules.ts` — mount `alert-rules`
- `GET /` — public — `?workspace_id=` list alert rules — `AlertRule[]`
- `POST /` — auth — create alert rule — `AlertRule`
- `PUT /:id` — auth — update alert rule — `AlertRule`
- `DELETE /:id` — auth — delete alert rule — `{success}`

### 21. `notifications.ts` — mount `notifications`
- `GET /` — auth — current user's notifications — `Notification[]`
- `POST /:id/read` — auth — mark read — `Notification`
- `POST /read-all` — auth — mark all read — `{success}`

### 22. `dashboard.ts` — mount `dashboard`
- `GET /` — public — `?workspace_id=` aggregate posture (grade counts, pending, auto-cleared, violations, trend, top-risk, recent ledger) — `DashboardSummary`

### 23. `reports.ts` — mount `reports`
- `GET /` — public — `?workspace_id=` list saved reports — `Report[]`
- `GET /:id` — public — report detail — `Report`
- `POST /generate` — auth — generate report by type (project|throughput|maintainer-change) — `Report`
- `GET /:id/export` — public — `?format=` export report — `{csv|json}`
- `DELETE /:id` — auth — delete report — `{success}`

### 24. `webhooks.ts` — mount `webhooks`
- `GET /` — public — `?workspace_id=` list webhooks — `Webhook[]`
- `POST /` — auth — create webhook — `Webhook`
- `PUT /:id` — auth — update webhook — `Webhook`
- `DELETE /:id` — auth — delete webhook — `{success}`
- `GET /:id/deliveries` — public — delivery log — `WebhookDelivery[]`
- `POST /:id/test` — auth — send a test delivery (records a delivery row) — `WebhookDelivery`

### 25. `billing.ts` — mount `billing`
- `GET /plan` — public(header user) — current plan/subscription + stripeEnabled — `{subscription,plan,stripeEnabled}`
- `POST /checkout` — auth — Stripe checkout (503 if unconfigured) — `{url}|503`
- `POST /portal` — auth — Stripe portal (503 if unconfigured) — `{url}|503`
- `POST /webhook` — public — Stripe webhook (503 if unconfigured) — `{received}|503`

---

## (c) `web/lib/api.ts` method list (method -> proxy path -> verb)

Workspaces & members:
- `listWorkspaces()` -> `/api/proxy/workspaces` GET
- `getWorkspace(id)` -> `/api/proxy/workspaces/{id}` GET
- `createWorkspace(body)` -> `/api/proxy/workspaces` POST
- `updateWorkspace(id, body)` -> `/api/proxy/workspaces/{id}` PUT
- `deleteWorkspace(id)` -> `/api/proxy/workspaces/{id}` DELETE
- `reseedWorkspace(id)` -> `/api/proxy/workspaces/{id}/reseed` POST
- `listMembers(workspaceId)` -> `/api/proxy/members?workspace_id={id}` GET
- `addMember(body)` -> `/api/proxy/members` POST
- `updateMember(id, body)` -> `/api/proxy/members/{id}` PUT
- `removeMember(id)` -> `/api/proxy/members/{id}` DELETE

Projects, manifests, inventory:
- `listProjects(workspaceId)` -> `/api/proxy/projects?workspace_id={id}` GET
- `getProject(id)` -> `/api/proxy/projects/{id}` GET
- `createProject(body)` -> `/api/proxy/projects` POST
- `updateProject(id, body)` -> `/api/proxy/projects/{id}` PUT
- `deleteProject(id)` -> `/api/proxy/projects/{id}` DELETE
- `getProjectDependencies(id)` -> `/api/proxy/projects/{id}/dependencies` GET
- `getProjectSummary(id)` -> `/api/proxy/projects/{id}/summary` GET
- `listManifests(projectId)` -> `/api/proxy/manifests?project_id={id}` GET
- `getManifest(id)` -> `/api/proxy/manifests/{id}` GET
- `uploadManifest(body)` -> `/api/proxy/manifests` POST
- `deleteManifest(id)` -> `/api/proxy/manifests/{id}` DELETE

Packages & maintainers:
- `listPackages(params)` -> `/api/proxy/packages?ecosystem=&q=` GET
- `getPackage(id)` -> `/api/proxy/packages/{id}` GET
- `getPackageVersions(id)` -> `/api/proxy/packages/{id}/versions` GET
- `getPackageMaintainers(id)` -> `/api/proxy/packages/{id}/maintainers` GET
- `listMaintainers(q)` -> `/api/proxy/maintainers?q={q}` GET
- `getMaintainer(id)` -> `/api/proxy/maintainers/{id}` GET

Updates & analysis:
- `listUpdates(params)` -> `/api/proxy/updates?workspace_id=&status=&project_id=` GET
- `getUpdate(id)` -> `/api/proxy/updates/{id}` GET
- `createUpdate(body)` -> `/api/proxy/updates` POST
- `importUpdates(body)` -> `/api/proxy/updates/import` POST
- `deleteUpdate(id)` -> `/api/proxy/updates/{id}` DELETE
- `reevaluateUpdate(id)` -> `/api/proxy/updates/{id}/reevaluate` POST
- `getRisk(updateId)` -> `/api/proxy/risk/{updateId}` GET
- `getRiskFactors(updateId)` -> `/api/proxy/risk/{updateId}/factors` GET
- `getScriptDiff(updateId)` -> `/api/proxy/script-diffs/{updateId}` GET
- `getDependencyDelta(updateId)` -> `/api/proxy/dependency-deltas/{updateId}` GET

Queue / triage:
- `getQueue(workspaceId)` -> `/api/proxy/queue?workspace_id={id}` GET
- `transitionUpdate(updateId, body)` -> `/api/proxy/queue/{updateId}/transition` POST
- `bulkTransition(body)` -> `/api/proxy/queue/bulk` POST
- `autoClear(workspaceId)` -> `/api/proxy/queue/auto-clear?workspace_id={id}` POST
- `assignUpdate(updateId, body)` -> `/api/proxy/queue/{updateId}/assign` POST

Policies & evaluation:
- `listPolicies(workspaceId)` -> `/api/proxy/policies?workspace_id={id}` GET
- `getPolicy(id)` -> `/api/proxy/policies/{id}` GET
- `createPolicy(body)` -> `/api/proxy/policies` POST
- `updatePolicy(id, body)` -> `/api/proxy/policies/{id}` PUT
- `deletePolicy(id)` -> `/api/proxy/policies/{id}` DELETE
- `simulatePolicy(id, body)` -> `/api/proxy/policies/{id}/simulate` POST
- `listPolicyRules(policyId)` -> `/api/proxy/policy-rules?policy_id={id}` GET
- `createPolicyRule(body)` -> `/api/proxy/policy-rules` POST
- `updatePolicyRule(id, body)` -> `/api/proxy/policy-rules/{id}` PUT
- `deletePolicyRule(id)` -> `/api/proxy/policy-rules/{id}` DELETE
- `getPolicyEvaluations(updateId)` -> `/api/proxy/policy-evaluations/{updateId}` GET
- `runPolicyEvaluation(updateId)` -> `/api/proxy/policy-evaluations/{updateId}/run` POST

Pinning:
- `listPinningAdvice(params)` -> `/api/proxy/pinning?workspace_id=&project_id=` GET
- `generatePinningAdvice(body)` -> `/api/proxy/pinning/generate` POST

Ledger:
- `listLedger(params)` -> `/api/proxy/ledger?workspace_id=&package=&actor=` GET
- `getLedgerEntry(id)` -> `/api/proxy/ledger/{id}` GET
- `exportLedger(params)` -> `/api/proxy/ledger/export?workspace_id=&format=` GET
- `verifyLedger(workspaceId)` -> `/api/proxy/ledger/verify?workspace_id={id}` GET

Incidents:
- `listIncidents()` -> `/api/proxy/incidents` GET
- `getIncident(id)` -> `/api/proxy/incidents/{id}` GET
- `replayIncident(id, body)` -> `/api/proxy/incidents/{id}/replay` POST

Rules (weights/bands):
- `getRules(workspaceId)` -> `/api/proxy/rules?workspace_id={id}` GET
- `updateRules(body)` -> `/api/proxy/rules` PUT
- `resetRules(body)` -> `/api/proxy/rules/reset` POST

Alerts & notifications:
- `listAlerts(workspaceId)` -> `/api/proxy/alerts?workspace_id={id}` GET
- `resolveAlert(id)` -> `/api/proxy/alerts/{id}/resolve` POST
- `listAlertRules(workspaceId)` -> `/api/proxy/alert-rules?workspace_id={id}` GET
- `createAlertRule(body)` -> `/api/proxy/alert-rules` POST
- `updateAlertRule(id, body)` -> `/api/proxy/alert-rules/{id}` PUT
- `deleteAlertRule(id)` -> `/api/proxy/alert-rules/{id}` DELETE
- `listNotifications()` -> `/api/proxy/notifications` GET
- `readNotification(id)` -> `/api/proxy/notifications/{id}/read` POST
- `readAllNotifications()` -> `/api/proxy/notifications/read-all` POST

Dashboard, reports, webhooks, billing:
- `getDashboard(workspaceId)` -> `/api/proxy/dashboard?workspace_id={id}` GET
- `listReports(workspaceId)` -> `/api/proxy/reports?workspace_id={id}` GET
- `getReport(id)` -> `/api/proxy/reports/{id}` GET
- `generateReport(body)` -> `/api/proxy/reports/generate` POST
- `exportReport(id, format)` -> `/api/proxy/reports/{id}/export?format={f}` GET
- `deleteReport(id)` -> `/api/proxy/reports/{id}` DELETE
- `listWebhooks(workspaceId)` -> `/api/proxy/webhooks?workspace_id={id}` GET
- `createWebhook(body)` -> `/api/proxy/webhooks` POST
- `updateWebhook(id, body)` -> `/api/proxy/webhooks/{id}` PUT
- `deleteWebhook(id)` -> `/api/proxy/webhooks/{id}` DELETE
- `getWebhookDeliveries(id)` -> `/api/proxy/webhooks/{id}/deliveries` GET
- `testWebhook(id)` -> `/api/proxy/webhooks/{id}/test` POST
- `getBillingPlan()` -> `/api/proxy/billing/plan` GET
- `startCheckout()` -> `/api/proxy/billing/checkout` POST
- `openPortal()` -> `/api/proxy/billing/portal` POST

---

## (d) Page list (URL -> file -> kind -> api methods used -> renders)

Public:
1. `/` -> `web/app/page.tsx` -> public -> (none) -> static landing: hero, feature grid, incident callouts, CTAs.
2. `/auth/sign-in` -> `web/app/auth/sign-in/page.tsx` -> public -> authClient -> sign-in form.
3. `/auth/sign-up` -> `web/app/auth/sign-up/page.tsx` -> public -> authClient -> sign-up form.
4. `/pricing` -> `web/app/pricing/page.tsx` -> public -> getBillingPlan, startCheckout -> plan tiers + upgrade CTA.

Dashboard (shared `web/app/dashboard/layout.tsx` -> `DashboardLayout` sidebar):
5. `/dashboard` -> `web/app/dashboard/page.tsx` -> dashboard -> getDashboard, listWorkspaces -> posture overview (grade counts, pending, trend, top-risk, recent ledger).
6. `/dashboard/queue` -> `web/app/dashboard/queue/page.tsx` -> dashboard -> getQueue, transitionUpdate, bulkTransition, autoClear, assignUpdate -> triage Kanban board.
7. `/dashboard/updates` -> `web/app/dashboard/updates/page.tsx` -> dashboard -> listUpdates, createUpdate, importUpdates, deleteUpdate -> updates list + create/import.
8. `/dashboard/updates/[id]` -> `web/app/dashboard/updates/[id]/page.tsx` -> dashboard -> getUpdate, getRisk, getRiskFactors, getScriptDiff, getDependencyDelta, getPolicyEvaluations, runPolicyEvaluation, reevaluateUpdate, transitionUpdate -> full risk breakdown + decide.
9. `/dashboard/projects` -> `web/app/dashboard/projects/page.tsx` -> dashboard -> listProjects, deleteProject -> projects list.
10. `/dashboard/projects/new` -> `web/app/dashboard/projects/new/page.tsx` -> dashboard -> createProject, uploadManifest -> create project + upload manifest.
11. `/dashboard/projects/[id]` -> `web/app/dashboard/projects/[id]/page.tsx` -> dashboard -> getProject, getProjectDependencies, getProjectSummary, listManifests, uploadManifest, updateProject -> project detail + inventory.
12. `/dashboard/packages` -> `web/app/dashboard/packages/page.tsx` -> dashboard -> listPackages -> package intelligence list + search.
13. `/dashboard/packages/[id]` -> `web/app/dashboard/packages/[id]/page.tsx` -> dashboard -> getPackage, getPackageVersions, getPackageMaintainers -> package profile (versions, maintainers, cadence chart).
14. `/dashboard/maintainers` -> `web/app/dashboard/maintainers/page.tsx` -> dashboard -> listMaintainers, getMaintainer -> maintainer registry + trust scores.
15. `/dashboard/policies` -> `web/app/dashboard/policies/page.tsx` -> dashboard -> listPolicies, createPolicy, deletePolicy -> policy profiles list.
16. `/dashboard/policies/[id]` -> `web/app/dashboard/policies/[id]/page.tsx` -> dashboard -> getPolicy, updatePolicy, listPolicyRules, createPolicyRule, updatePolicyRule, deletePolicyRule, simulatePolicy -> policy + rules editor.
17. `/dashboard/rules` -> `web/app/dashboard/rules/page.tsx` -> dashboard -> getRules, updateRules, resetRules -> risk weights & grade-band config with live preview.
18. `/dashboard/pinning` -> `web/app/dashboard/pinning/page.tsx` -> dashboard -> listPinningAdvice, generatePinningAdvice, listProjects -> version-pinning advisor.
19. `/dashboard/ledger` -> `web/app/dashboard/ledger/page.tsx` -> dashboard -> listLedger, getLedgerEntry, exportLedger, verifyLedger -> decision ledger + integrity verify.
20. `/dashboard/incidents` -> `web/app/dashboard/incidents/page.tsx` -> dashboard -> listIncidents, getIncident, replayIncident -> known-incident replay library.
21. `/dashboard/alerts` -> `web/app/dashboard/alerts/page.tsx` -> dashboard -> listAlerts, resolveAlert, listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule -> alerts feed + alert rules.
22. `/dashboard/notifications` -> `web/app/dashboard/notifications/page.tsx` -> dashboard -> listNotifications, readNotification, readAllNotifications -> notifications.
23. `/dashboard/reports` -> `web/app/dashboard/reports/page.tsx` -> dashboard -> listReports, getReport, generateReport, exportReport, deleteReport -> reports & export.
24. `/dashboard/webhooks` -> `web/app/dashboard/webhooks/page.tsx` -> dashboard -> listWebhooks, createWebhook, updateWebhook, deleteWebhook, getWebhookDeliveries, testWebhook -> webhooks & integrations.
25. `/dashboard/settings` -> `web/app/dashboard/settings/page.tsx` -> dashboard -> getWorkspace, updateWorkspace, listMembers, addMember, updateMember, removeMember, reseedWorkspace, getBillingPlan -> workspace settings, members, reseed.

Route handlers (not pages): `web/app/api/auth/[...path]/route.ts`, `web/app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav sections

- **Overview**: Dashboard (`/dashboard`)
- **Triage**: Update Queue (`/dashboard/queue`), Updates (`/dashboard/updates`)
- **Inventory**: Projects (`/dashboard/projects`), Packages (`/dashboard/packages`), Maintainers (`/dashboard/maintainers`)
- **Governance**: Policies (`/dashboard/policies`), Risk Rules (`/dashboard/rules`), Pinning Advisor (`/dashboard/pinning`), Decision Ledger (`/dashboard/ledger`)
- **Intelligence**: Incident Replays (`/dashboard/incidents`), Alerts (`/dashboard/alerts`), Reports (`/dashboard/reports`)
- **Settings**: Notifications (`/dashboard/notifications`), Webhooks (`/dashboard/webhooks`), Settings (`/dashboard/settings`)

---

## Consistency invariants

- Every api method maps to exactly one backend endpoint declared in section (b).
- Every backend endpoint is consumed by at least one page (section d) or is billing/webhook infra.
- 25 route files (incl. billing), 25 pages (4 public + 21 dashboard), 28 tables (incl. billing).
- Grading is deterministic (no external network at request time); sample-data seeder populates packages, versions, maintainers, updates, incidents on first boot.
