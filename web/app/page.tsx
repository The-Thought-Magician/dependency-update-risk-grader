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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime-400 text-sm font-black text-neutral-950">
            D
          </span>
          <span className="text-lg font-black tracking-tight text-lime-300">DependencyUpdateRiskGrader</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-neutral-300 hover:text-neutral-100">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-neutral-300 hover:text-neutral-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-lime-300"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-1 rounded-md border border-lime-500/30 bg-lime-400/10 px-3 py-1 text-xs font-medium text-lime-300">
          Supply-chain risk, graded at merge time
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black tracking-tight text-neutral-50 sm:text-5xl">
          Stop rubber-stamping the bump PR that ships a backdoor.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-400">
          DependencyUpdateRiskGrader scores how risky each dependency version jump is using the malware-injection
          signals that real attacks share: maintainer changes, new install scripts, off-cadence releases, and provenance
          gaps. Safe bumps auto-clear. Risky bumps get gated and logged.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-lime-400 px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-lime-300"
          >
            Grade your first bump
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-6 py-3 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
          >
            Sign In
          </Link>
        </div>
      </section>

      <section className="border-t border-neutral-800 bg-neutral-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-neutral-100">The merge-fatigue problem</h2>
          <p className="mx-auto mt-4 max-w-3xl text-center text-neutral-400">
            Teams running Dependabot or Renovate face dozens of bump PRs a week. The poisoned one is rarely in your
            application code. It is in the new version of a transitive dependency, and it slides through with the 40
            benign bumps reviewed on autopilot. CVE scanners are blind to a brand-new backdoor because no advisory exists
            yet. We grade the behavioral and provenance signals of the jump itself.
          </p>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-neutral-100">What it grades</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <h3 className="text-base font-semibold text-lime-300">{f.title}</h3>
                <p className="mt-2 text-sm text-neutral-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-800 bg-neutral-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold text-neutral-100">Replays of real attacks</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-neutral-400">
            Every workspace ships pre-loaded with known-incident replays so you can see exactly which factor would have
            caught each attack before it merged.
          </p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {incidents.map((i) => (
              <div key={i.name} className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
                <h3 className="font-mono text-base font-semibold text-neutral-100">{i.name}</h3>
                <p className="mt-2 text-sm text-neutral-400">{i.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-24 text-center">
        <h2 className="text-3xl font-black tracking-tight text-neutral-50">Auto-clear the safe 90%. Review the rest.</h2>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">
          Every feature is free. Connect a manifest, import your bump PRs, and get a defensible grade in seconds.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-lime-400 px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-lime-300"
          >
            Get Started
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-6 py-3 text-sm font-semibold text-neutral-200 hover:bg-neutral-800"
          >
            See Pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-8 text-center text-sm text-neutral-600">
        <p>DependencyUpdateRiskGrader — merge-time supply-chain risk grading.</p>
      </footer>
    </main>
  )
}
