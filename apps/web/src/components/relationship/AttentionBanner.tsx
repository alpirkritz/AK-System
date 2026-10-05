'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'

/** One line on the dashboard: the strongest shift, then the relationships page. */
export function AttentionBanner() {
  const { data } = trpc.insights.relationshipBoard.useQuery(undefined, { staleTime: 60_000 })
  if (!data) return null
  const all = [...data.people, ...data.circles]
  if (all.length === 0) return null
  const gap = (c: { recentAvg: number | null; olderAvg: number | null }) => Math.abs((c.recentAvg ?? 0) - (c.olderAvg ?? 0))
  const top = [...all].sort((a, b) => gap(b) - gap(a))[0]
  if (!top) return null
  const rest = all.length - 1
  const verb = top.trend === 'cooling' ? 'מתקרר' : 'מתחמם'
  return (
    <Link
      href="/relationships"
      className="card block p-3 no-underline hover:border-[#2dd4bf]"
      data-testid="attention-banner"
    >
      <span className="text-[11px] font-semibold text-[#5a688c]">קשרים</span>
      <p className="text-sm text-[#eef3fb] mt-1">
        {top.name} {verb}
        {rest > 0 ? <span className="text-[#97a4c2]"> · ועוד {rest}</span> : null}
      </p>
    </Link>
  )
}
