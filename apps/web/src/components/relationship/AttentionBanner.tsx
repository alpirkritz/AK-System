'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { pickAttentionShift } from '@/lib/attention-shift'

/** Dashboard card only when someone clearly needs a 1:1. Otherwise nothing. */
export function AttentionBanner() {
  const { data } = trpc.insights.relationshipBoard.useQuery(undefined, { staleTime: 60_000 })
  if (!data) return null
  const shift = pickAttentionShift(data.people)
  if (!shift) return null
  return (
    <Link
      href="/relationships"
      className="card block p-3 no-underline hover:border-[#2dd4bf]"
      data-testid="attention-banner"
    >
      <span className="text-[11px] font-semibold text-[#5a688c]">כדאי לקבוע 1:1</span>
      <p className="text-sm text-[#eef3fb] mt-1">
        {shift.name}
        {shift.rest > 0 ? <span className="text-[#97a4c2]"> · ועוד {shift.rest}</span> : null}
      </p>
      {shift.dataReason ? (
        <p className="text-xs text-[#97a4c2] mt-1 line-clamp-2">{shift.dataReason}</p>
      ) : null}
    </Link>
  )
}
