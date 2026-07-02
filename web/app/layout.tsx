import type { Metadata } from 'next'
import { Work_Sans } from 'next/font/google'
import './globals.css'
import CommandPalette from '@/components/CommandPalette'

const workSans = Work_Sans({ subsets: ['latin'], variable: '--font-work-sans' })

export const metadata: Metadata = {
  title: 'DependencyUpdateRiskGrader',
  description: 'Grade the malware-injection risk of every dependency version bump, auto-clear the safe ones, gate the risky ones.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={workSans.variable}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">
        {children}
        <CommandPalette />
      </body>
    </html>
  )
}
