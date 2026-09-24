'use client'

import { useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { format } from 'date-fns'

export type WarmthTrend = 'warming' | 'cooling' | 'stable' | null

export interface SentimentPointView {
  meetingId: string
  date: string
  title: string
  score: number | null
  mood: string | null
  sentiment: number
}

export interface WarmthView {
  trend: WarmthTrend
  recentAvg: number | null
  olderAvg: number | null
  count: number
  timeline: SentimentPointView[]
}

const LABELS = {
  person: { warming: 'מתחמם', cooling: 'מתקרר' },
  circle: { warming: 'הפגישה מתחממת', cooling: 'הפגישה מתקררת' },
} as const

const TREND_HE: Record<string, string> = { warming: 'מתחמם', cooling: 'מתקרר', stable: 'יציב' }

/** Green ↑ / yellow ↓ pill; hidden for stable or insufficient data. Click reveals the timeline. */
export function WarmthBadge({ warmth, scope }: { warmth: WarmthView; scope: 'person' | 'circle' }) {
  const [open, setOpen] = useState(false)
  if (warmth.trend !== 'warming' && warmth.trend !== 'cooling') return null
  const cooling = warmth.trend === 'cooling'
  const Icon = cooling ? TrendingDown : TrendingUp
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="pill text-[10px] inline-flex items-center gap-1 shrink-0"
        style={{
          background: cooling ? 'rgba(234,179,8,0.12)' : 'rgba(34,197,94,0.12)',
          color: cooling ? '#facc15' : '#4ade80',
          borderColor: cooling ? 'rgba(234,179,8,0.35)' : 'rgba(34,197,94,0.35)',
        }}
        data-testid="warmth-badge"
      >
        <Icon className="w-3 h-3" aria-hidden />
        {LABELS[scope][warmth.trend]}
      </button>
      {open && <SentimentTimeline warmth={warmth} scope={scope} />}
    </>
  )
}

export function SentimentTimeline({ warmth, scope }: { warmth: WarmthView; scope: 'person' | 'circle' }) {
  return (
    <div className="basis-full mt-2 rounded-lg p-2 text-[11px]" style={{ background: '#101a2e', border: '1px solid #223052' }}>
      <ul className="space-y-1">
        {warmth.timeline.map((p) => (
          <li key={p.meetingId} className="flex items-center gap-2">
            <span className="text-[#5a688c] w-12 shrink-0 tabular-nums">{format(new Date(p.date + 'T00:00:00'), 'dd/MM/yy')}</span>
            <a href={`/meetings/${p.meetingId}`} className="flex-1 min-w-0 truncate text-[#b8c4dc] hover:text-[#eef3fb]">
              {p.title}
            </a>
            <span className="h-1.5 rounded-full shrink-0" style={{
              width: `${Math.max(6, Math.round(Math.abs(p.sentiment) * 40))}px`,
              background: p.sentiment >= 0 ? '#4ade80' : '#facc15',
            }} aria-hidden />
            {p.score != null && <span className="text-[#97a4c2] tabular-nums w-8 text-left">{p.score}/10</span>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[#5a688c]">
        ממוצע אחרון: {warmth.recentAvg ?? '—'} · ממוצע קודם: {warmth.olderAvg ?? '—'} · מגמה: {warmth.trend ? TREND_HE[warmth.trend] : '—'}
        {scope === 'circle' && ` · מבוסס על ${warmth.count} פגישות`}
      </p>
    </div>
  )
}
