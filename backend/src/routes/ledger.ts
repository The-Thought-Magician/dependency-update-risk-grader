import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ledger_entries, updates, packages } from '../db/schema.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Hash-chain helper. Each entry's hash commits to its own immutable content
// PLUS the previous entry's hash, forming a tamper-evident chain per workspace.
// This MUST match the serialization the writer (queue/incident routes) uses.
// ----------------------------------------------------------------------------

// policy_result/factors_snapshot are stored as jsonb, which does not preserve
// object key order across a DB round-trip — hashing them would make every
// entry fail verification the moment it's re-read from Postgres, even
// untampered. They're kept as unhashed supporting metadata on the row instead;
// the hash commits to the immutable decision fields only.
export function computeEntryHash(entry: {
  workspace_id: string
  update_id: string
  decision: string
  grade_at_decision: string
  score_at_decision: number
  actor_id: string
  justification: string
  created_at: Date | string
  prev_hash: string
}): string {
  const createdAt =
    entry.created_at instanceof Date ? entry.created_at.toISOString() : String(entry.created_at)
  const payload = JSON.stringify({
    workspace_id: entry.workspace_id,
    update_id: entry.update_id,
    decision: entry.decision,
    grade_at_decision: entry.grade_at_decision,
    score_at_decision: entry.score_at_decision,
    actor_id: entry.actor_id,
    justification: entry.justification,
    created_at: createdAt,
    prev_hash: entry.prev_hash,
  })
  return createHash('sha256').update(payload).digest('hex')
}

// ----------------------------------------------------------------------------
// GET / — list ledger entries; filter by workspace_id (+ optional package, actor)
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const pkg = c.req.query('package')
  const actor = c.req.query('actor')

  const rows = await db
    .select({
      entry: ledger_entries,
      from_version: updates.from_version,
      to_version: updates.to_version,
      package_name: packages.name,
      ecosystem: packages.ecosystem,
    })
    .from(ledger_entries)
    .leftJoin(updates, eq(ledger_entries.update_id, updates.id))
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.created_at))

  let result = rows.map((r) => ({
    ...r.entry,
    from_version: r.from_version,
    to_version: r.to_version,
    package_name: r.package_name,
    ecosystem: r.ecosystem,
  }))

  if (actor) result = result.filter((r) => r.actor_id === actor)
  if (pkg) {
    const needle = pkg.toLowerCase()
    result = result.filter((r) => (r.package_name ?? '').toLowerCase().includes(needle))
  }

  return c.json(result)
})

// ----------------------------------------------------------------------------
// GET /export — export the workspace ledger as JSON or CSV
// (declared before /:id so "export" is not captured as an id)
// ----------------------------------------------------------------------------

router.get('/export', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const format = (c.req.query('format') ?? 'json').toLowerCase()

  const rows = await db
    .select({
      entry: ledger_entries,
      package_name: packages.name,
      from_version: updates.from_version,
      to_version: updates.to_version,
    })
    .from(ledger_entries)
    .leftJoin(updates, eq(ledger_entries.update_id, updates.id))
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(ledger_entries.created_at)

  const flat = rows.map((r) => ({
    id: r.entry.id,
    created_at:
      r.entry.created_at instanceof Date
        ? r.entry.created_at.toISOString()
        : String(r.entry.created_at),
    package_name: r.package_name ?? '',
    from_version: r.from_version ?? '',
    to_version: r.to_version ?? '',
    decision: r.entry.decision,
    grade_at_decision: r.entry.grade_at_decision,
    score_at_decision: r.entry.score_at_decision,
    actor_id: r.entry.actor_id,
    justification: r.entry.justification,
    prev_hash: r.entry.prev_hash,
    entry_hash: r.entry.entry_hash,
  }))

  if (format === 'csv') {
    const headers = [
      'id',
      'created_at',
      'package_name',
      'from_version',
      'to_version',
      'decision',
      'grade_at_decision',
      'score_at_decision',
      'actor_id',
      'justification',
      'prev_hash',
      'entry_hash',
    ]
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(',')]
    for (const row of flat) {
      lines.push(headers.map((h) => esc((row as Record<string, unknown>)[h])).join(','))
    }
    const csv = lines.join('\n')
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ledger-${workspaceId}.csv"`,
    })
  }

  return c.json({ format: 'json', count: flat.length, entries: flat })
})

// ----------------------------------------------------------------------------
// GET /verify — verify hash-chain integrity for a workspace ledger
// ----------------------------------------------------------------------------

router.get('/verify', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const chain = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(ledger_entries.created_at)

  let prev = ''
  let valid = true
  let brokenAt: string | null = null
  const issues: Array<{ entry_id: string; reason: string }> = []

  for (const e of chain) {
    // 1. prev_hash must link to the prior entry's stored hash.
    if (e.prev_hash !== prev) {
      valid = false
      brokenAt = brokenAt ?? e.id
      issues.push({
        entry_id: e.id,
        reason: `prev_hash mismatch: expected "${prev}", found "${e.prev_hash}"`,
      })
    }
    // 2. recomputed content hash must equal the stored entry_hash.
    const recomputed = computeEntryHash({
      workspace_id: e.workspace_id,
      update_id: e.update_id,
      decision: e.decision,
      grade_at_decision: e.grade_at_decision,
      score_at_decision: e.score_at_decision,
      actor_id: e.actor_id,
      justification: e.justification,
      created_at: e.created_at,
      prev_hash: e.prev_hash,
    })
    if (recomputed !== e.entry_hash) {
      valid = false
      brokenAt = brokenAt ?? e.id
      issues.push({
        entry_id: e.id,
        reason: `entry_hash mismatch: content has been altered`,
      })
    }
    prev = e.entry_hash
  }

  return c.json({
    valid,
    broken_at: brokenAt,
    entry_count: chain.length,
    issues,
  })
})

// ----------------------------------------------------------------------------
// GET /:id — ledger entry detail (with factors snapshot + joined update info)
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db
    .select({
      entry: ledger_entries,
      from_version: updates.from_version,
      to_version: updates.to_version,
      package_name: packages.name,
      ecosystem: packages.ecosystem,
    })
    .from(ledger_entries)
    .leftJoin(updates, eq(ledger_entries.update_id, updates.id))
    .leftJoin(packages, eq(updates.package_id, packages.id))
    .where(eq(ledger_entries.id, id))

  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({
    ...row.entry,
    from_version: row.from_version,
    to_version: row.to_version,
    package_name: row.package_name,
    ecosystem: row.ecosystem,
  })
})

export default router
