'use client'

import { trpc } from '@/lib/trpc'

/** Last 24 hours of what every agent delivered (spec: agent-episodes). */
export function EpisodesPanel() {
  const { data = [], isLoading } = trpc.episodes.list.useQuery({ sinceHours: 24 })
  const rows = data as Array<{ id: string; agentId: string; channel: string; summary: string; createdAt: string }>
  const time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <section className="card p-4 space-y-3" data-testid="episodes-panel">
      <div>
        <h3 className="text-sm font-medium text-[#eef3fb]">היסטוריה — 24 שעות</h3>
        <p className="text-[11px] text-[#5a688c] mt-0.5">מה כל הסוכנים כבר אמרו לך. הוגו רואה את זה, כדי לא לחזור על עצמו.</p>
      </div>
      {isLoading ? (
        <p className="text-[11px] text-[#5a688c]">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-[#5a688c]">אין ריצות ב-24 השעות האחרונות.</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 30).map((e) => (
            <li key={e.id} className="text-[12px] leading-relaxed">
              <span className="text-[#5a688c] tabular-nums">{time.format(new Date(e.createdAt))}</span>
              <span className="text-[#97a4c2] mx-1.5">{e.agentId}</span>
              <span className="text-[#cdd7ea]">{e.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
