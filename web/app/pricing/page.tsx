'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const includedFeatures = [
  'Per-update risk score engine (A-F grade)',
  'Maintainer-change detection & trust scores',
  'Install-script & lifecycle-hook diffing',
  'Release-timing & diff-size anomaly analysis',
  'Dependency-delta & blast-radius analysis',
  'Provenance, signing & reputation signals',
  'Update-queue triage board with auto-clear',
  'Policy gate engine & rule evaluation',
  'Immutable, hash-chained decision ledger',
  'Known-incident replay library',
  'Alerts, webhooks & exportable reports',
  'Unlimited workspaces, projects & members',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const plan = await api.getBillingPlan()
        if (mounted) setStripeEnabled(Boolean(plan?.stripeEnabled))
      } catch {
        if (mounted) setStripeEnabled(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-400 text-sm font-black text-zinc-950">
            D
          </span>
          <span className="text-lg font-black tracking-tight text-pink-300">DependencyUpdateRiskGrader</span>
        </Link>
        <div className="flex items-center gap-4">
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

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight text-zinc-50">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          Every capability is free while in beta. No seat limits, no metering, no credit card.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-pink-500/30 bg-zinc-900 p-8 text-left shadow-lg">
          <div className="flex items-center justify-between">
            <span className="rounded-md border border-pink-500/30 bg-pink-400/10 px-3 py-1 text-xs font-medium text-pink-300">
              Free plan
            </span>
            <span className="text-sm text-zinc-500">Everything included</span>
          </div>
          <div className="mt-6 flex items-baseline gap-1">
            <span className="text-5xl font-black text-zinc-50">$0</span>
            <span className="text-zinc-500">/ month</span>
          </div>
          <ul className="mt-6 space-y-2">
            {includedFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-0.5 text-pink-400">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/auth/sign-up"
            className="mt-8 block w-full rounded-lg bg-pink-400 py-3 text-center text-sm font-semibold text-zinc-950 hover:bg-pink-300"
          >
            Start for free
          </Link>
          <p className="mt-3 text-center text-xs text-zinc-600">
            {stripeEnabled === null
              ? ' '
              : stripeEnabled
                ? 'Paid tiers are available — manage billing from your workspace settings.'
                : 'Billing is not enabled. All features are free for every workspace.'}
          </p>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>DependencyUpdateRiskGrader — merge-time supply-chain risk grading.</p>
      </footer>
    </main>
  )
}
