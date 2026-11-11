'use client'

import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { WaitingRow, dueNow } from './WaitingList'
import { useCommitmentEditor } from './useCommitmentEditor'

const SHOWN = 5

/** Dashboard digest: who owes me something today or is already late. Hidden when nobody does. */
export function WaitingTodayCard() {
  const { data: buckets } = trpc.waiting.list.useQuery()
  const editor = useCommitmentEditor()
  if (!buckets) return null
  const items = dueNow(buckets)
  if (items.length === 0) return null
  const overdueIds = new Set(buckets.overdue.map((i) => i.id))

  return (
    <section aria-label="חייבים לי היום" className="card p-4" data-testid="waiting-today-card">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-base font-semibold text-[#eef3fb]">חייבים לי היום</h2>
        <span className="pill" title="להיום · באיחור">{buckets.today.length}{buckets.overdue.length > 0 ? ` · ${buckets.overdue.length} באיחור` : ''}</span>
        <Link href="/waiting" className="section-link ms-auto shrink-0">לכל הרשימה</Link>
      </div>
      {editor.modal}
      <ul>
        {items.slice(0, SHOWN).map((i) => (
          <WaitingRow key={`${i.kind}-${i.id}`} item={i} overdue={overdueIds.has(i.id)} onOpenCommitment={editor.open} />
        ))}
      </ul>
      {items.length > SHOWN && (
        <Link href="/waiting" className="text-[11px] text-[#5a688c] hover:text-[#97a4c2]">ועוד {items.length - SHOWN}</Link>
      )}
    </section>
  )
}
