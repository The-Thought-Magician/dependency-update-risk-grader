import Link from 'next/link'

const features = [
  {
    title: 'Per-Update Risk Score Engine',
    body: 'A deterministic 0-100 score mapped to an A-F grade for every proposed version jump, with a full weighted-factor breakdown.',
  },
  {
    title: 'Maintainer-Change Detection',
    body: 'Flags ownership and publisher handoffs between the pinned version and the proposed one. A brand-new maintainer is the highest-weight signal.',
  },
  {
    title: 'Install-Script & Lifecycle-Hook Diff',
    body: 'Catches newly added postinstall / preinstall hooks, remote fetches, shell spawns, and obfuscated blobs across npm, PyPI, and Cargo.',
  },
  {
    title: 'Release-Timing Anomaly Detection',
    body: 'Models each package historical cadence and flags off-rhythm releases, odd publish hours, and burst-publish patterns.',
  },
  {
    title: 'Diff-Size & Content Anomaly Analysis',
    body: 'Surfaces patch releases that ship major-sized diffs, new binary or minified artifacts, and tarball-vs-repo divergence.',
  },
  {
    title: 'Dependency-Delta Analysis',
    body: 'Shows newly added or removed dependencies, range widening, and the transitive blast radius across your projects.',
  },
  {
    title: 'Provenance & Signing Verification',
    body: 'Checks npm provenance attestations, SLSA level, source-repo linkage, and 2FA-enforced publishing.',
  },
  {
    title: 'Update-Queue Triage Board',
    body: 'A Kanban board that ranks every pending bump by risk, auto-clears the safe ones, and focuses human review on the risky 10%.',
  },
  {
    title: 'Policy Gate & Decision Ledger',
    body: 'Block updates that violate policy and record every merge decision in an immutable, hash-chained audit ledger.',
  },
]

const incidents = [
  { name: 'event-stream', detail: 'New maintainer took over an abandoned package and shipped a wallet-stealing payload.' },
  { name: 'xz / liblzma', detail: 'A long-game maintainer handoff planted a backdoor in release tarballs that did not match the repo.' },
  { name: 'ua-parser-js', detail: 'A hijacked publish added a malicious postinstall script to a wildly popular package.' },
  { name: 'node-ipc', detail: 'A trusted maintainer pushed a destructive payload in a routine-looking patch release.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-400 text-sm font-black text-zinc-950">
            D
          </span>
          <span className="text-lg font-black tracking-tight text-pink-300">DependencyUpdateRiskGrader</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-zinc-300 hover:text-zinc-100">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-zinc-300 hover:text-zinc-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-pink-400 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-pink-300"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-1 rounded-md border border-pink-500/30 bg-pink-400/10 px-3 py-1 text-xs font-medium text-pink-300">
              Supply-chain risk, graded at merge time
            </span>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-zinc-50 sm:text-5xl">
              npm i lodash@4.17.21 is fine. The next Dependabot bump might not be.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-zinc-400">
              DependencyUpdateRiskGrader diffs the pinned version against the proposed one and computes a
              deterministic 0-100 score from the signals real supply-chain attacks share: a maintainer handoff, a
              newly added <code className="rounded bg-zinc-900 px-1 py-0.5 text-pink-300">postinstall</code> hook, an
              off-cadence release, a tarball that does not match the tagged commit. No CVE required, because a
              brand-new backdoor does not have one yet.
            </p>
            <div className="mt-10 flex items-center gap-4">
              <Link
                href="/auth/sign-up"
                className="rounded-lg bg-pink-400 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-pink-300"
              >
                Grade your first bump
              </Link>
              <Link
                href="/auth/sign-in"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                Sign In
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
              <span className="ml-2 font-mono text-xs text-zinc-500">package.json.diff — bump PR #4821</span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-6">
              <code>
                <span className="text-zinc-500">{'  "dependencies": {'}</span>{'\n'}
                <span className="text-red-400">{'-   "event-stream": "3.3.5",'}</span>{'\n'}
                <span className="text-green-400">{'+   "event-stream": "3.3.6",'}</span>{'\n'}
                <span className="text-zinc-500">{'    "express": "4.19.2"'}</span>{'\n'}
                <span className="text-zinc-500">{'  }'}</span>
              </code>
            </pre>
            <div className="border-t border-zinc-800 bg-zinc-900/60 px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-zinc-500">grade --package event-stream --from 3.3.5 --to 3.3.6</span>
                <span className="rounded-md bg-red-500/10 px-2 py-0.5 font-mono text-xs font-bold text-red-400">F · 91/100</span>
              </div>
              <ul className="mt-3 space-y-1.5 font-mono text-xs text-zinc-400">
                <li>
                  <span className="text-pink-400">+42</span> new maintainer published this version (first seen 6 days ago)
                </li>
                <li>
                  <span className="text-pink-400">+31</span> postinstall hook added, not present in 3.3.5
                </li>
                <li>
                  <span className="text-pink-400">+12</span> release published 03:14 UTC, off historical cadence
                </li>
                <li>
                  <span className="text-pink-400">+6</span> tarball diverges from tagged repo commit
                </li>
              </ul>
              <div className="mt-3 font-mono text-xs text-zinc-600">status: gated — blocked by policy &quot;no new maintainer + install script&quot;</div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-zinc-100">The merge-fatigue problem</h2>
          <p className="mx-auto mt-4 max-w-3xl text-center text-zinc-400">
            Teams running Dependabot or Renovate face dozens of bump PRs a week. The poisoned one is rarely in your
            application code. It is in the new version of a transitive dependency, and it slides through with the 40
            benign bumps reviewed on autopilot. CVE scanners are blind to a brand-new backdoor because no advisory exists
            yet. We grade the behavioral and provenance signals of the jump itself.
          </p>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-zinc-100">What it grades</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h3 className="text-base font-semibold text-pink-300">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-800 bg-zinc-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-zinc-100">Replays of real attacks</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-zinc-400">
            Every workspace ships pre-loaded with known-incident replays so you can see exactly which factor would have
            caught each attack before it merged.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {incidents.map((i) => (
              <div key={i.name} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
                <h3 className="font-mono text-base font-semibold text-zinc-100">{i.name}</h3>
                <p className="mt-2 text-sm text-zinc-400">{i.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24 text-center">
        <h2 className="text-3xl font-black tracking-tight text-zinc-50">Auto-clear the safe 90%. Review the rest.</h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          Every feature is free. Connect a manifest, import your bump PRs, and get a defensible grade in seconds.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-pink-400 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-pink-300"
          >
            Get Started
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            See Pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>DependencyUpdateRiskGrader — merge-time supply-chain risk grading.</p>
      </footer>
    </main>
  )
}
