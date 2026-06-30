# DependencyUpdateRiskGrader — Product & Feature Specification

## Overview

DependencyUpdateRiskGrader grades how risky each dependency version jump is, so engineering teams stop rubber-stamping the routine bump PR that ships a backdoor. For every proposed upgrade (e.g. `lodash 4.17.20 -> 4.17.21`, `event-stream 3.3.5 -> 3.3.6`), the platform computes a deterministic per-update risk score from malware-injection signals observed *at merge time*: maintainer changes, newly added install/postinstall scripts, release-timing anomalies, abnormal diff size, dependency-tree expansion, provenance gaps, and reputation deltas. Safe bumps are auto-cleared; risky bumps are surfaced on a triage board, gated by policy, and recorded in an immutable decision ledger for post-incident audit.

The product connects to (or accepts uploads of) a team's manifest + lockfile inventory, ingests bump PRs from Dependabot/Renovate or manual entry, and renders a single risk grade (A–F / 0–100) per update with a full factor breakdown and remediation guidance. A built-in sample-data seeder pre-loads realistic packages, version jumps, maintainer histories, and known-incident replays (event-stream, xz/liblzma, ua-parser-js, node-ipc) so the product is demoable on first sign-in.

## Problem

Malicious package updates reach production through routine version-bump PRs that reviewers approve on autopilot. The dangerous change is rarely in the application code; it is in the *new version of a transitive dependency* — a freshly added `postinstall` hook, a package republished by a brand-new maintainer who just took over an abandoned project, or an off-cadence release pushed at 3am that does not match the project's historical rhythm. Teams running Dependabot or Renovate face dozens of bump PRs per week and suffer "merge fatigue," so the one poisoned bump slides through with the other 40 benign ones. Existing tooling either *automates* the bumps (making the problem worse) or scans for *known CVEs* (which by definition do not yet exist for a brand-new supply-chain attack). There is no per-bump, merge-time risk signal focused specifically on the malware-injection vectors that the event-stream, xz, ua-parser-js, and ongoing npm worm campaigns all share.

## Target Users

- **AppSec / Product Security engineers** owning dependency hygiene at companies with large npm / PyPI / Maven / Cargo / Go surfaces. Primary buyer; has security-tooling budget authority.
- **Engineering leads / platform engineers** drowning in Dependabot/Renovate PRs who want to auto-clear the safe 90% and focus human review on the risky 10%.
- **Release engineers** who must sign off that a release's dependency delta is clean.
- **Incident responders** who, after a supply-chain scare, need an auditable record of which risky updates were merged, by whom, with what justification.

## Why this is NOT an existing project (near-neighbors)

- **dependency-update-bot (corpus near-neighbor):** *automates* dependency bumps and opens PRs. It is the thing that *creates* the rubber-stamp problem. We do the opposite: we grade the risk of a specific jump and gate the merge. We consume bump PRs; we do not generate them.
- **dependency-audit-service (corpus near-neighbor):** scans the installed tree for *known CVEs* (advisory database lookups). A brand-new supply-chain backdoor has no CVE yet, so a CVE scanner is blind to exactly the attack we catch. We grade *behavioral/provenance* signals of a version jump, not advisory matches.
- **maintainer-succession-vault (nearest base):** a watchlist for package *ownership handoffs* in the abstract. We use maintainer-change as ONE of many scored factors, applied to a *concrete proposed version jump at merge time*, and fold it into an actionable per-PR grade with policy gating and a decision ledger.
- **ci-pipeline-permission-auditor (nearest sibling in the 40):** audits CI machine-identity privilege and pipeline permission sprawl — a different attack surface (the build system's own credentials), not the risk of the dependency content being pulled.
- **Snyk / Dependabot security alerts (commercial):** advisory-driven CVE alerting and license scanning; not a deterministic, per-version-jump malware-injection risk grade with auto-clear + triage board + policy gate + ledger.

The unique core: **GRADE the risk of a specific version jump using malware-injection signals at merge time, auto-clear the safe ones, gate the risky ones, and keep an audit ledger.**

---

## Major Feature Sections

### 1. Per-Update Risk Score Engine
The flagship. A deterministic 0–100 score (mapped to A–F grade) for every proposed version jump.
- Weighted factor model combining maintainer-change, install-script, release-timing, diff-size, dependency-delta, provenance, popularity-delta, and version-jump-magnitude signals.
- Configurable factor weights per workspace (policy profile).
- Score breakdown: each contributing factor with its raw value, normalized sub-score, and weight contribution.
- Grade bands (A: 0–9, B: 10–24, C: 25–49, D: 50–74, F: 75–100) with band thresholds editable per workspace.
- Confidence indicator (how much signal data was available).
- Re-grade on demand when new data (e.g. provenance, maintainer record) arrives.
- Historical score trend for a package across its version history.

### 2. Maintainer-Change Detection
Flag ownership/publisher changes between the trusted (currently pinned) version and the proposed version.
- Compare publisher identity, maintainer list, and org ownership across the two versions.
- "New maintainer published this version" flag (highest-weight signal).
- Maintainer first-seen date and account age.
- Maintainer trust score derived from history (packages owned, tenure, prior incidents).
- Detect maintainer *additions* vs *removals* vs full handoff.
- Cross-reference against a known-bad/known-good maintainer reputation list.
- Per-package maintainer timeline view.

### 3. Install-Script & Lifecycle-Hook Diff
The classic npm malware vector: a bump that newly adds `postinstall`/`preinstall`/`prepare` scripts.
- Diff lifecycle scripts (preinstall, install, postinstall, prepare, prepublish) between versions.
- Flag *newly added* install scripts (the dangerous case) vs pre-existing ones.
- Flag scripts that fetch remote content (curl/wget/fetch), spawn shells, or write outside the package.
- Heuristic obfuscation detector (base64 blobs, eval, hex-encoded strings).
- Binary/native-build hook detection (node-gyp, makefile invocation appearing for the first time).
- Per-ecosystem hook mapping (npm scripts, PyPI setup.py/pyproject build hooks, Cargo build.rs).
- Script diff rendered inline with added/removed lines.

### 4. Release-Timing Anomaly Detection
Detect off-cadence releases that break the package's historical rhythm.
- Compute the package's historical inter-release interval distribution.
- Flag releases pushed far outside the normal cadence (e.g. 18 months silent then sudden patch).
- Flag unusual publish hours relative to maintainer's historical pattern.
- Flag version-number anomalies (skipped versions, sudden major after long patch-only history).
- "Burst publish" detection (many versions in a short window).
- Cadence anomaly z-score contributing to the risk engine.

### 5. Diff-Size & Content Anomaly Analysis
Abnormal diff size or content shape between versions.
- Files-changed, lines-added/removed counts between versions.
- Flag a "patch" release with a major-sized diff (semver/content mismatch).
- New file-type introductions (e.g. a `.wasm`, minified bundle, or vendored binary appearing).
- Tarball-vs-repo divergence flag (published artifact does not match the git tag).
- Entropy/minification spike detection on changed files.
- Size-delta sub-score for the risk engine.

### 6. Dependency-Delta Analysis
Changes to the package's own dependency tree introduced by the jump.
- New direct/transitive dependencies added by the new version.
- Dependencies removed.
- Version-range widening (pinned -> caret/star) that expands attack surface.
- Newly introduced packages that themselves carry install scripts or new maintainers (recursive).
- Transitive blast-radius estimate (how many of your projects this reaches).

### 7. Provenance & Signing Verification
Supply-chain integrity signals.
- npm provenance attestation presence/validity (Sigstore).
- Package signature / SLSA level where available.
- Source repo linkage verification (repository field resolves and matches).
- 2FA-enforced-publish indicator for the maintainer.
- Provenance-gap flag (no attestation where the ecosystem supports it).

### 8. Popularity & Reputation Delta
Reputation context for weighting.
- Download counts and trend.
- Project age, star count, contributor count (where linked).
- Deprecation / archived-repo flags.
- Typosquat-name heuristic against popular packages.
- Reputation tier (foundational, popular, niche, obscure) influencing factor weights.

### 9. Update-Queue Triage Board
Rank all pending bump PRs by risk; auto-approve the safe ones.
- Kanban-style board: columns by status (Pending, Auto-Cleared, Needs Review, Blocked, Approved, Rejected).
- Sort/filter by grade, ecosystem, project, age.
- One-click approve / reject / request-changes with reason capture.
- Auto-clear rule: updates at or below a configurable grade auto-move to Approved.
- Bulk actions on multiple updates.
- SLA / staleness highlighting for long-pending high-risk items.
- Assignment of reviewers to updates.

### 10. Policy Gate Engine
Block updates that violate configured policy.
- Rule types: block new postinstall scripts, block new-maintainer publishes, block grade >= threshold, block provenance gaps, block off-cadence, require 2FA publish, allowlist/denylist packages.
- Per-workspace policy profiles (e.g. "Strict prod", "Lenient dev").
- Rule evaluation result per update (which rules passed/failed).
- Policy simulation / dry-run against historical updates.
- Override workflow with mandatory justification (feeds the ledger).
- Default policy templates seeded.

### 11. Version-Pinning Advisor
Recommend pin strategy per dependency.
- Recommend exact-pin vs range based on risk history and reputation tier.
- Detect overly loose ranges in current manifests.
- Suggest a "known-good" pinned version when the latest is risky.
- Lockfile-vs-manifest drift detection.
- Generate suggested manifest/lockfile patch snippets.

### 12. Decision Ledger (Audit Trail)
Immutable record of every update decision for post-incident audit.
- Append-only ledger entry per decision: update, grade at decision time, decision, actor, justification, policy result, timestamp.
- Tamper-evident hash chain (each entry references prior entry hash).
- Filter/search by package, actor, date, decision.
- Export ledger (CSV/JSON) for compliance.
- "What did we know at the time" snapshot of factors per decision.

### 13. Projects & Inventory
Manage the set of repos/manifests being watched.
- Create projects; attach manifests + lockfiles (upload or paste).
- Parse npm (package.json/package-lock/pnpm-lock), PyPI (requirements/pyproject), Maven (pom), Cargo (Cargo.toml/lock), Go (go.mod).
- Inventory of all dependencies with current pinned versions.
- Per-project dependency count, risk posture summary.
- Tagging/grouping of projects (e.g. prod, internal).

### 14. Bump-PR Ingestion
Bring in proposed updates.
- Manual single-update creation (package, from-version, to-version, project, ecosystem).
- Bulk import from a Dependabot/Renovate-style payload (uploaded JSON).
- Sample-data generated bump PRs across ecosystems.
- Link an update to its source PR URL.
- Re-evaluate an update.

### 15. Package Intelligence Profiles
A profile page per package aggregating everything known.
- Version history with per-version grades.
- Maintainer timeline.
- Release cadence chart.
- Known-incident annotations.
- Dependents within the user's projects.

### 16. Known-Incident Replay Library
Pre-loaded famous supply-chain attacks for demo/training.
- event-stream / flatmap-stream, xz/liblzma, ua-parser-js, node-ipc, coa/rc, colors.js.
- Replay the exact version jump and show how the grader would have flagged it.
- Annotations explaining which factor caught it.
- "Test your policy against this incident" action.

### 17. Risk Rules & Weights Configuration
Tune the engine per workspace.
- Editable factor weights with live re-score preview.
- Grade-band threshold editor.
- Auto-clear threshold setting.
- Per-ecosystem weight overrides.
- Reset-to-default.

### 18. Alerts & Notifications
Surface risky events.
- Alert rules (e.g. any grade F update, any new-maintainer publish on a foundational package).
- In-app notification feed, mark-read.
- Per-rule channel config (in-app; webhook stub).
- Digest summary of the queue.

### 19. Dashboard & Risk Posture Overview
Landing dashboard for signed-in users.
- Aggregate risk posture: counts by grade, pending review count, auto-cleared count.
- Trend of incoming bump risk over time.
- Top-risk pending updates.
- Policy-violation count.
- Recent ledger activity.

### 20. Reports & Export
Shareable summaries.
- Per-project risk report.
- Per-period queue throughput report (auto-cleared vs reviewed vs blocked).
- Maintainer-change report across all watched packages.
- Export to CSV/JSON.

### 21. Reviewers & Workspace Settings
Collaboration + workspace config.
- Workspace profile, member roster (by user id), reviewer roles.
- Default ecosystem, default policy profile.
- Notification preferences.
- Sample-data reseed / reset.

### 22. Webhooks & Integrations (stubs)
Outbound integration points.
- Configure outbound webhook endpoints for queue/alert events.
- Delivery log (attempts, status) — deterministic local record.
- Integration catalog (Dependabot, Renovate, GitHub Checks) shown as configurable connectors.

---

## Data Model (tables)

- `workspaces` — tenant/workspace per owner.
- `workspace_members` — user membership + role in a workspace.
- `projects` — a repo/manifest set being watched.
- `manifests` — uploaded/parsed manifest+lockfile content per project + ecosystem.
- `packages` — a package identity (name + ecosystem), reputation tier, popularity stats.
- `package_versions` — a specific version of a package with publish metadata.
- `maintainers` — maintainer identity, account age, trust score.
- `package_maintainers` — which maintainers owned which package_version (join).
- `dependencies` — a dependency entry within a project (package + current pinned version + range).
- `updates` — a proposed version jump (bump PR): project, package, from/to version, status, source PR URL.
- `risk_scores` — computed score for an update: total, grade, confidence, factor breakdown jsonb.
- `risk_factors` — per-factor rows for an update (factor type, raw value, sub-score, weight).
- `script_diffs` — lifecycle-script diff result per update.
- `dependency_deltas` — added/removed deps per update.
- `policies` — policy profile per workspace (weights/thresholds config).
- `policy_rules` — individual rules within a policy.
- `policy_evaluations` — rule pass/fail results per update.
- `ledger_entries` — append-only decision ledger with hash chain.
- `incidents` — known-incident replay library entries.
- `alert_rules` — alert rule config per workspace.
- `alerts` — fired alerts.
- `notifications` — per-user in-app notifications.
- `pinning_advice` — version-pinning recommendations per dependency.
- `reports` — generated/saved reports.
- `webhooks` — outbound webhook endpoint config.
- `webhook_deliveries` — webhook delivery attempt log.
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription state.

## API Surface (high level, all under /api/v1)

- `workspaces`, `members` — workspace CRUD + membership.
- `projects`, `manifests` — project CRUD, manifest upload/parse.
- `packages`, `package-versions`, `maintainers` — package intelligence reads.
- `dependencies` — inventory reads.
- `updates` — bump-PR CRUD, re-evaluate.
- `risk` — score + factor breakdown reads, re-grade.
- `script-diffs`, `dependency-deltas` — per-update analysis reads.
- `queue` — triage board, status transitions, bulk actions, auto-clear.
- `policies`, `policy-rules`, `policy-evaluations` — policy config + evaluation + simulation.
- `pinning` — pinning advice.
- `ledger` — decision ledger entries + export.
- `incidents` — known-incident replay.
- `rules` — risk weights/thresholds config.
- `alerts`, `alert-rules` — alerting.
- `notifications` — in-app notifications.
- `dashboard` — aggregate posture.
- `reports` — report generation/export.
- `webhooks` — webhook config + delivery log.
- `billing` — plan/checkout/portal/webhook.

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (static + billing CTA).

Dashboard (under `/dashboard`, sidebar chrome):
5. `/dashboard` — risk posture overview.
6. `/dashboard/queue` — update triage board.
7. `/dashboard/updates` — all updates list.
8. `/dashboard/updates/[id]` — update detail (full risk breakdown, script diff, deltas, decide).
9. `/dashboard/projects` — projects list.
10. `/dashboard/projects/[id]` — project detail + inventory.
11. `/dashboard/projects/new` — create project / upload manifest.
12. `/dashboard/packages` — package intelligence list.
13. `/dashboard/packages/[id]` — package profile (versions, maintainers, cadence).
14. `/dashboard/maintainers` — maintainer registry + trust scores.
15. `/dashboard/policies` — policy profiles list.
16. `/dashboard/policies/[id]` — policy editor (rules).
17. `/dashboard/rules` — risk weights & grade-band config.
18. `/dashboard/pinning` — version-pinning advisor.
19. `/dashboard/ledger` — decision ledger.
20. `/dashboard/incidents` — known-incident replay library.
21. `/dashboard/alerts` — alerts feed + alert rules.
22. `/dashboard/notifications` — notifications.
23. `/dashboard/reports` — reports & export.
24. `/dashboard/webhooks` — webhooks & integrations.
25. `/dashboard/settings` — workspace settings, members, reseed.
