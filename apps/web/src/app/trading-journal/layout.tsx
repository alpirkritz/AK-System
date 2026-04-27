import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trading Journal AI – My Space',
  description: 'AI-assisted trading journal with structured trade log',
}

export default function TradingJournalLayout({ children }: { children: React.ReactNode }) {
  return children
}
