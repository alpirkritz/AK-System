'use client'

import { useState } from 'react'
import {
  ATTENTION_REASON_LABELS,
  ATTENTION_STATUS_LABELS,
  CONTACT_CHANNEL_LABELS,
  type AttentionReason,
  type AttentionStatus,
  type ContactChannel,
} from '@ak-system/types'
import { trpc } from '@/lib/trpc'

export type BoardTrend = 'warming' | 'cooling' | 'stable' | null

export interface BoardAttention {
  status: AttentionStatus | null
  reasons: AttentionReason[]
  severity: number
  lastContact: { date: string; channel: ContactChannel } | null
  last1on1Date: string | null
  next1on1Date: string | null
  suppressed: 'scheduled' | 'acknowledged' | null
  email?: string | null
}

export interface BoardCard {
  id: string
  name: string
  /** People only: the cross-channel status. */
  attention?: BoardAttention | null
  trend: BoardTrend
  recentAvg: number | null
  olderAvg: number | null
  count: number
  minForTrend: number
  avgScore: number | null
  lastDate: string | null
  latestMood: string | null
  latestInsight: string | null
  dataReason: string
  note: string | null
  timeline: { meetingId: string; date: string; title: string; score: number | null; sentiment: number }[]
}

function signed(n: number | null): string {
  if (n == null) return '—'
  const body = Math.abs(n).toFixed(2)
  if (n > 0) return `+${body}`
  if (n < 0) return `-${body}`
  return '0.00'
}

function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : date
}

function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const PILL: Record<'warming' | 'cooling' | 'stable' | 'none', { bg: string; fg: string; border: string }> = {
  cooling: { bg: 'rgba(234,179,8,0.12)', fg: '#facc15', border: 'rgba(234,179,8,0.35)' },
  warming: { bg: 'rgba(34,197,94,0.12)', fg: '#4ade80', border: 'rgba(34,197,94,0.35)' },
  stable: { bg: 'rgba(96,165,250,0.12)', fg: '#93c5fd', border: 'rgba(96,165,250,0.3)' },
  none: { bg: 'rgba(122,137,171,0.12)', fg: '#97a4c2', border: 'rgba(122,137,171,0.3)' },
}

const STATUS_PILL: Record<AttentionStatus, (typeof PILL)['none']> = {
  needs_1on1: PILL.cooling,
  good: PILL.warming,
  steady: PILL.stable,
}

/** Google Calendar "new event" with the person invited, for the "קבע 1:1" button. */
export function oneOnOneInviteUrl(name: string, email: string | null | undefined): string {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `1:1 ${name}` })
  if (email) params.set('add', email)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function trendLabel(card: Pick<BoardCard, 'trend' | 'count' | 'minForTrend'>, subject: 'person' | 'circle'): string {
  if (card.trend === 'cooling') return 'מתקרר'
  if (card.trend === 'warming') return 'מתחמם'
  if (card.trend === 'stable') return 'יציב'
  return `${card.count}/${card.minForTrend} ${subject === 'circle' ? 'מפגשים' : 'שיחות'}`
}

export function RelationshipCard({
  card,
  subject,
  onOpen,
}: {
  card: BoardCard
  subject: 'person' | 'circle'
  onOpen: () => void
}) {
  const utils = trpc.useUtils()
  const [draft, setDraft] = useState(card.note ?? '')
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = trpc.insights.setWarmthNote.useMutation({
    onSuccess: async () => {
      setSaved(true)
      setWriting(false)
      setError(null)
      await utils.insights.relationshipBoard.invalidate()
    },
    onError: (err) => {
      setSaved(false)
      setError(err.message.includes('280') ? 'עד 280 תווים.' : 'לא הצלחנו לשמור. נסה שוב.')
    },
  })
  const ack = trpc.insights.acknowledgeAttention.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.insights.relationshipBoard.invalidate(), utils.insights.relationshipFlags.invalidate()])
    },
  })
  const attention = subject === 'person' ? card.attention ?? null : null
  const pill = attention?.status ? STATUS_PILL[attention.status] : PILL[card.trend ?? 'none']
  const pillText = attention?.status ? ATTENTION_STATUS_LABELS[attention.status] : trendLabel(card, subject)
  const flagged = attention?.status === 'needs_1on1'
  const moving = card.trend === 'cooling' || card.trend === 'warming'
  const shown = [...card.timeline].reverse()
  const noteShown = card.note && !writing

  const submit = (note: string | null) => {
    setSaved(false)
    if (note && note.trim().length > 280) {
      setError('עד 280 תווים.')
      return
    }
    save.mutate({ subject, id: card.id, note })
  }

  return (
    <article
      className="card p-3 space-y-2"
      data-testid="relationship-card"
      data-trend={card.trend ?? 'none'}
      data-status={attention?.status ?? 'none'}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[#eef3fb] truncate">{card.name}</h3>
        <span
          className="pill text-[10px] shrink-0"
          style={{ background: pill.bg, color: pill.fg, borderColor: pill.border }}
        >
          {pillText}
        </span>
        <button type="button" className="btn-ghost text-[11px] ms-auto" onClick={onOpen}>פתח כרטיס</button>
      </div>
      {attention ? (
        <div className="space-y-1.5" data-testid="relationship-attention">
          {flagged && attention.reasons.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {attention.reasons.map((r) => (
                <span key={r} className="pill text-[10px]" style={{ background: PILL.cooling.bg, color: PILL.cooling.fg, borderColor: PILL.cooling.border }}>
                  {ATTENTION_REASON_LABELS[r]}
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-[11px] text-[#5a688c] flex flex-wrap gap-x-3 gap-y-0.5">
            {attention.lastContact ? (
              <span>
                קשר אחרון <span className="tabular-nums text-[#97a4c2]">{dayLabel(attention.lastContact.date)}</span> · {CONTACT_CHANNEL_LABELS[attention.lastContact.channel]}
              </span>
            ) : null}
            {attention.last1on1Date ? <span>1:1 אחרון <span className="tabular-nums">{dayLabel(attention.last1on1Date)}</span></span> : null}
            {attention.suppressed === 'scheduled' && attention.next1on1Date ? (
              <span className="text-[#4ade80]">1:1 קבוע ל־{dayLabel(attention.next1on1Date)}</span>
            ) : null}
            {attention.suppressed === 'acknowledged' ? <span>סימנת שראית · יחזור אחרי פגישה חדשה</span> : null}
          </p>
          {flagged && attention.suppressed !== 'scheduled' ? (
            <div className="flex flex-wrap gap-2">
              <a
                className="btn btn-primary text-xs no-underline"
                href={oneOnOneInviteUrl(card.name, attention.email)}
                target="_blank"
                rel="noreferrer"
              >
                קבע 1:1
              </a>
              {attention.suppressed === 'acknowledged' ? (
                <button type="button" className="btn btn-ghost text-xs" disabled={ack.isPending} onClick={() => ack.mutate({ personId: card.id, ack: false })}>
                  החזר לרשימה
                </button>
              ) : (
                <button type="button" className="btn btn-ghost text-xs" disabled={ack.isPending} onClick={() => ack.mutate({ personId: card.id, ack: true })}>
                  ראיתי
                </button>
              )}
            </div>
          ) : null}
          {ack.isError ? <p className="text-xs text-red-400">לא הצלחנו לשמור. נסה שוב.</p> : null}
        </div>
      ) : null}
      <SentimentChart points={shown} />
      <p className="text-[11px] text-[#5a688c] flex flex-wrap gap-x-3 gap-y-0.5">
        {card.avgScore != null ? <span>ציון ממוצע <span className="tabular-nums text-[#97a4c2]">{fmtScore(card.avgScore)}/10</span></span> : null}
        {card.count > 0 ? <span>{card.count} {subject === 'circle' ? 'מפגשים' : 'שיחות'} מנותחות</span> : null}
        {card.lastDate ? <span>שיחה מנותחת אחרונה <span className="tabular-nums">{dayLabel(card.lastDate)}</span></span> : null}
        {moving ? (
          <span>
            ממוצע אחרון <span className="tabular-nums">{signed(card.recentAvg)}</span> · קודם <span className="tabular-nums">{signed(card.olderAvg)}</span>
          </span>
        ) : null}
      </p>
      {noteShown ? (
        <p className="text-sm text-[#eef3fb] leading-relaxed">
          <span className="text-[11px] text-[#5a688c] block mb-0.5">למה אני חושב כך</span>
          {card.note}
        </p>
      ) : null}
      <p className="text-xs text-[#97a4c2] leading-relaxed">{card.dataReason}</p>
      {card.latestMood || card.latestInsight ? (
        <div className="rounded-md border border-[#223052] bg-[#0b1220]/60 px-2.5 py-2 space-y-1">
          {card.latestMood ? (
            <p className="text-xs text-[#b8c4dc]"><span className="text-[#5a688c]">אווירה: </span>{card.latestMood}</p>
          ) : null}
          {card.latestInsight ? (
            <p className="text-xs text-[#b8c4dc] leading-relaxed"><span className="text-[#5a688c]">תובנה: </span>{card.latestInsight}</p>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-1">
        {card.timeline.slice(0, 3).map((p) => (
          <li key={p.meetingId} className="flex items-center gap-2 text-xs text-[#b8c4dc]">
            <span className="text-[#5a688c] tabular-nums w-10 shrink-0">{dayLabel(p.date)}</span>
            <span className="truncate flex-1">{p.title}</span>
            {p.score != null ? <span className="text-[#5a688c] tabular-nums">{p.score}/10</span> : null}
            <span className="tabular-nums w-12 text-left" style={{ color: p.sentiment < 0 ? '#facc15' : '#4ade80' }}>{signed(p.sentiment)}</span>
          </li>
        ))}
      </ul>
      {writing || !card.note ? (
        writing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submit(draft)
            }}
          >
            <label className="sr-only" htmlFor={`note-${card.id}`}>למה אני חושב כך</label>
            <input
              id={`note-${card.id}`}
              className="input flex-1 min-w-[12rem] text-sm"
              maxLength={280}
              value={draft}
              placeholder="במשפט אחד, מה השתנה"
              onChange={(e) => { setDraft(e.target.value); setSaved(false); setError(null) }}
            />
            <button type="submit" className="btn btn-primary text-xs" disabled={save.isPending}>שמור</button>
            {card.note ? (
              <button type="button" className="btn btn-ghost text-xs" onClick={() => { setWriting(false); setDraft(card.note ?? '') }}>ביטול</button>
            ) : null}
          </form>
        ) : (
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setWriting(true)}>רשום את הדעה שלך</button>
        )
      ) : (
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => { setWriting(true); setDraft(card.note ?? ''); setSaved(false) }}>ערוך</button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={save.isPending}
            onClick={() => {
              if (window.confirm(`למחוק את הדעה שלך על ${card.name}?`)) submit(null)
            }}
          >
            נקה
          </button>
        </div>
      )}
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {saved ? <p className="text-xs text-[#4ade80]">נשמר</p> : null}
    </article>
  )
}

function SentimentChart({ points }: { points: { meetingId: string; sentiment: number }[] }) {
  if (points.length === 0) return null
  return (
    <div className="relative flex items-stretch gap-1 h-16" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#223052]" />
      {points.map((p) => {
        const mag = Math.min(1, Math.abs(p.sentiment))
        const h = Math.max(3, mag * 28)
        const up = p.sentiment >= 0
        return (
          <div key={p.meetingId} className="relative flex-1">
            <div
              className="absolute inset-x-0.5 rounded-sm"
              style={{
                height: h,
                background: up ? '#4ade80' : '#facc15',
                [up ? 'bottom' : 'top']: '50%',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
