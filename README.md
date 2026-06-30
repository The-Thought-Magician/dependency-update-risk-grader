# DependencyUpdateRiskGrader

DependencyUpdateRiskGrader grades how risky each dependency version jump is, so engineering teams stop rubber-stamping the routine bump PR that ships a backdoor. For every proposed upgrade (e.g. `lodash 4.17.20 -> 4.17.21`, `event-stream 3.3.5 -> 3.3.6`), the platform computes a deterministic per-update risk score from malware-injection signals observed at merge time: maintainer changes, newly added install/postinstall scripts, release-timing anomalies, abnormal diff size, dependency-tree expansion, provenance gaps, and reputation deltas.

Safe bumps are auto-cleared; risky bumps are surfaced on a triage board, gated by policy, and recorded in an immutable decision ledger for post-incident audit. The product connects to (or accepts uploads of) a team's manifest + lockfile inventory, ingests bump PRs from Dependabot/Renovate or manual entry, and renders a single risk grade (A-F / 0-100) per update with a full factor breakdown and remediation guidance. A built-in sample-data seeder pre-loads realistic packages, version jumps, maintainer histories, and known-incident replays (event-stream, xz/liblzma, ua-parser-js, node-ipc) so the product is demoable on first sign-in.

See [`docs/idea.md`](docs/idea.md) for the full product and feature specification.

## Stack

- **Backend:** Node.js + TypeScript (run with `tsx`), Express-style HTTP API in `backend/`.
- **Frontend:** Next.js 15+ / React 19+, TypeScript (strict), Tailwind 4, App Router in `web/`.
- **Database:** PostgreSQL (via `DATABASE_URL`).
- **Package manager:** pnpm (always). Never npm or yarn.

## Local Development

Prerequisites: Node.js 22.x, pnpm, and a PostgreSQL database.

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL and PORT (see Environment Variables)
node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default `3001` locally).

### Frontend

```bash
cd web
pnpm install
# create web/.env.local with NEXT_PUBLIC_API_URL pointing at the backend
pnpm dev
```

The frontend runs on http://localhost:3000 and talks to the backend at `NEXT_PUBLIC_API_URL`.

### Docker Compose

To bring the backend and web up together:

```bash
docker compose up --build
```

## Environment Variables

### Backend

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `PORT` | Port the backend listens on (`3001` locally, `10000` on Render). |
| `NODE_ENV` | `development` or `production`. |
| `FRONTEND_URL` | Allowed frontend origin for CORS. |

### Frontend

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the backend API. |

## Access

All features are free for signed-in users. There are no paid tiers or feature gates: once a user signs in, the full risk-grading engine, maintainer-change detection, install-script diffing, triage board, policy gating, decision ledger, and sample-data seeder are all available.

## Deployment

- **Backend:** Render (see [`render.yaml`](render.yaml)). Set `DATABASE_URL` and `FRONTEND_URL` as Render environment variables (`sync: false`).
- **Frontend:** Vercel, with `rootDirectory: web`, `framework: nextjs`, and Node 22.x.
