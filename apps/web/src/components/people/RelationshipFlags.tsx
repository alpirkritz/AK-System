'use client'

import { trpc } from '@/lib/trpc'

function signed(n: number | null): string {
  if (n == null) return '—'
  const body = Math.abs(n).toFixed(2)
  if (n > 0) return `+${body}`
  if (n < 0) return `-${body}`
  return '0.00'
}

/**
 * Warming and cooling people on the list itself. Opening a person is optional.
 */
export function RelationshipFlags({ onOpen, hideWhenEmpty = false }: { onOpen: (personId: string) => void; hideWhenEmpty?: boolean }) {
  const { data, isLoading } = trpc.insights.relationshipFlags.useQuery(undefined, { staleTime: 60_000 })
  if (isLoading || !data) return null
  const empty = data.cooling.length === 0 && data.warming.length === 0
  if (empty && hideWhenEmpty) return null

  return (
    <section className="mb-4 rounded-lg p-3" style={{ background: '#141f36', border: '1px solid #29395d' }} data-testid="relationship-flags">
      <h2 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">דגלים</h2>
      {empty ? (
        <p className="text-xs text-[#5a688c]">אין כרגע קשר שמתחמם או מתקרר.</p>
      ) : (
        <div className="space-y-2">
          <FlagRow label="מתקררים" tone="cooling" people={data.cooling} onOpen={onOpen} />
          <FlagRow label="מתחממים" tone="warming" people={data.warming} onOpen={onOpen} />
        </div>
      )}
    </section>
  )
}

function FlagRow({
  label,
  tone,
  people,
  onOpen,
}: {
  label: string
  tone: 'cooling' | 'warming'
  people: { personId: string; name: string; recentAvg: number | null; olderAvg: number | null }[]
  onOpen: (personId: string) => void
}) {
  if (people.length === 0) return null
  const cooling = tone === 'cooling'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold w-16 shrink-0" style={{ color: cooling ? '#facc15' : '#4ade80' }}>
        {cooling ? '↓' : '↑'} {label}
      </span>
      {people.map((p) => (
        <button
          key={p.personId}
          type="button"
          className="pill text-[11px]"
          style={{
            background: cooling ? 'rgba(234,179,8,0.12)' : 'rgba(34,197,94,0.12)',
            color: cooling ? '#facc15' : '#4ade80',
            borderColor: cooling ? 'rgba(234,179,8,0.35)' : 'rgba(34,197,94,0.35)',
          }}
          onClick={() => onOpen(p.personId)}
        >
          {p.name}
          <span className="text-[#97a4c2]"> · {signed(p.recentAvg)} מ-{signed(p.olderAvg)}</span>
        </button>
      ))}
    </div>
  )
}
