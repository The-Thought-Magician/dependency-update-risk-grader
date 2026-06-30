import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  updates,
  risk_scores,
  ledger_entries,
  alerts,
  packages,
  projects,
  workspaces,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// Order grades from best to worst for trend / top-risk ranking.
const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 }

function gradeRank(grade: string): number {
  return GRADE_ORDER[grade] ?? 99
}

// ----------------------------------------------------------------------------
// GET / — aggregate risk posture summary for a workspace.
//   ?workspace_id= (required)
// Returns: grade counts, pending/auto-cleared/violations counts, a 14-day trend,
// the top-risk updates, and the most recent ledger entries.
// ----------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  // Pull every update in the workspace joined with its score, package and project.
  const rows = await db
    .select({
      update_id: updates.id,
      status: updates.status,
      from_version: updates.from_version,
      to_version: updates.to_version,
      bump_type: updates.bump_type,
      source: updates.source,
      created_at: updates.created_at,
      updated_at: updates.updated_at,
      package_id: packages.id,
      package_name: packages.name,
      ecosystem: packages.ecosystem,
      project_id: projects.id,
      project_name: projects.name,
      total_score: risk_scores.total_score,
      grade: risk_scores.grade,
      confidence: risk_scores.confidence,
      computed_at: risk_scores.computed_at,
    })
    .from(updates)
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .leftJoin(projects, eq(updates.project_id, projects.id))
    .leftJoin(risk_scores, eq(risk_scores.update_id, updates.id))
    .where(eq(updates.workspace_id, workspaceId))

  // Grade counts.
  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0, ungraded: 0 }
  let pending = 0
  let autoCleared = 0
  let blocked = 0
  let approved = 0
  let rejected = 0
  let needsReview = 0

  for (const r of rows) {
    if (r.grade && gradeCounts[r.grade] !== undefined) gradeCounts[r.grade]++
    else gradeCounts.ungraded++

    switch (r.status) {
      case 'pending':
        pending++
        break
      case 'auto_cleared':
        autoCleared++
        break
      case 'blocked':
        blocked++
        break
      case 'approved':
        approved++
        break
      case 'rejected':
        rejected++
        break
      case 'needs_review':
        needsReview++
        break
    }
  }

  // Policy violations = updates that produced a blocked/rejected decision OR a
  // failing grade (D/F) still pending review.
  const violations = rows.filter(
    (r) => r.status === 'blocked' || r.status === 'rejected' || (r.grade === 'F' && r.status === 'pending'),
  ).length

  // 14-day trend: bucket updates by UTC day and count + worst grade per day.
  const DAY_MS = 86_400_000
  const now = Date.now()
  const trendMap = new Map<string, { count: number; worstGrade: string; scoreSum: number; scored: number }>()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS).toISOString().slice(0, 10)
    trendMap.set(d, { count: 0, worstGrade: 'A', scoreSum: 0, scored: 0 })
  }
  for (const r of rows) {
    if (!r.created_at) continue
    const day = new Date(r.created_at).toISOString().slice(0, 10)
    const bucket = trendMap.get(day)
    if (!bucket) continue
    bucket.count++
    if (r.grade && gradeRank(r.grade) > gradeRank(bucket.worstGrade)) bucket.worstGrade = r.grade
    if (typeof r.total_score === 'number') {
      bucket.scoreSum += r.total_score
      bucket.scored++
    }
  }
  const trend = Array.from(trendMap.entries()).map(([date, v]) => ({
    date,
    count: v.count,
    worst_grade: v.count > 0 ? v.worstGrade : null,
    avg_score: v.scored > 0 ? Number((v.scoreSum / v.scored).toFixed(2)) : null,
  }))

  // Top-risk updates: highest score / worst grade, pending or needs_review first.
  const topRisk = rows
    .filter((r) => r.grade)
    .sort((a, b) => {
      const gr = gradeRank(b.grade!) - gradeRank(a.grade!)
      if (gr !== 0) return gr
      return (b.total_score ?? 0) - (a.total_score ?? 0)
    })
    .slice(0, 8)
    .map((r) => ({
      update_id: r.update_id,
      package_name: r.package_name,
      ecosystem: r.ecosystem,
      project_name: r.project_name,
      from_version: r.from_version,
      to_version: r.to_version,
      bump_type: r.bump_type,
      status: r.status,
      grade: r.grade,
      total_score: r.total_score,
      confidence: r.confidence,
    }))

  // Recent ledger entries.
  const recentLedger = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.created_at))
    .limit(10)

  // Open alerts count.
  const openAlerts = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.workspace_id, workspaceId), eq(alerts.is_resolved, false)))

  const totalUpdates = rows.length
  const gradedUpdates = rows.filter((r) => r.grade).length
  const avgScore =
    gradedUpdates > 0
      ? Number((rows.reduce((s, r) => s + (r.total_score ?? 0), 0) / gradedUpdates).toFixed(2))
      : null

  return c.json({
    workspace: { id: ws.id, name: ws.name, slug: ws.slug, auto_clear_max_grade: ws.auto_clear_max_grade },
    totals: {
      updates: totalUpdates,
      graded: gradedUpdates,
      pending,
      auto_cleared: autoCleared,
      approved,
      rejected,
      blocked,
      needs_review: needsReview,
      violations,
      open_alerts: openAlerts.length,
      avg_score: avgScore,
    },
    grade_counts: gradeCounts,
    trend,
    top_risk: topRisk,
    recent_ledger: recentLedger,
  })
})

export default router
