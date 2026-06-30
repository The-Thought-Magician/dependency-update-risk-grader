import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DependencyUpdateRiskGrader',
  description: 'Grade the malware-injection risk of every dependency version bump, auto-clear the safe ones, gate the risky ones.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
