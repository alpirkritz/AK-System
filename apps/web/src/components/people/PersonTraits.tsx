'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { trpc } from '@/lib/trpc'

const SOURCE_LABEL: Record<string, string> = {
  meeting_analysis: 'פגישה',
  whatsapp_dm_summary: 'וואטסאפ',
  email_thread: 'מייל',
}

export interface TraitSummary {
  traits: { id: string; label: string; line: string; supportCount: number }[]
  traitsAt: string | null
  stale: boolean
  hasSources: boolean
  sourceCount: number
  evidenceCount: number
}

function jerusalemDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso))
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return `${Number(day)}.${Number(month)}`
}

function shortDay(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-')
  return d && m ? `${Number(d)}.${Number(m)}` : isoDate
}

function clauseOf(label: string, line: string): string {
  return line.startsWith(label) ? line.slice(label.length).trim() : line
}

export function PersonTraits({ personId, summary }: { personId: string; summary: TraitSummary }) {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<string | null>(null)
  const detail = trpc.insights.personTraitDetail.useQuery({ personId }, { enabled: open })

  const invalidate = () => {
    utils.insights.personContext.invalidate({ personId })
    utils.insights.personTraits.invalidate({ personId })
    utils.insights.personTraitDetail.invalidate({ personId })
  }
  const write = trpc.insights.writePersonTraits.useMutation({
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err.message),
  })
  const dismiss = trpc.insights.dismissPersonTrait.useMutation({
    onSuccess: (res) => { setUndo(res.id); invalidate() },
    onError: (err) => setError(err.message),
  })
  const restore = trpc.insights.restorePersonTrait.useMutation({
    onSuccess: () => { setUndo(null); invalidate() },
  })

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(timer)
  }, [undo])

  const run = () => write.mutate({ personId })

  if (!summary.hasSources && summary.traits.length === 0) {
    return <p className="text-[#5a688c]" data-testid="person-traits-empty">אין עדיין שיחות לנתח.</p>
  }

  if (summary.traits.length === 0) {
    return (
      <div data-testid="person-traits">
        <p className="text-[#b8c4dc] mb-2">עוד אין תכונות.</p>
        <button type="button" className="btn" disabled={write.isPending} onClick={run}>
          {write.isPending ? 'מנתח…' : summary.traitsAt ? 'נתח שוב' : 'נתח אופי'}
        </button>
        {error ? <p className="text-[#fb7185] mt-2" role="alert">{error}</p> : null}
      </div>
    )
  }

  return (
    <div data-testid="person-traits" className="space-y-2">
      <ul className="space-y-1.5">
        {summary.traits.map((trait) => (
          <li key={trait.id} className="text-sm leading-relaxed">
            <span className="font-semibold text-[#eef3fb]">{trait.label}</span>
            {clauseOf(trait.label, trait.line) ? <span className="text-[#b8c4dc]"> {clauseOf(trait.label, trait.line)}</span> : null}
          </li>
        ))}
      </ul>
      {summary.traits.length < 3 ? (
        <p className="text-[11px] text-[#5a688c]">צריך עוד שיחות כדי לתאר אותו בביטחון.</p>
      ) : null}
      {summary.traitsAt ? (
        <p className="text-[11px] text-[#5a688c]">לפי {summary.sourceCount} שיחות · {jerusalemDay(summary.traitsAt)}</p>
      ) : null}
      {summary.stale ? (
        <button type="button" className="text-[11px] text-[#5a688c] underline underline-offset-2 disabled:opacity-50" disabled={write.isPending} onClick={run}>
          {write.isPending ? 'מנתח…' : 'יש שיחות חדשות · נתח שוב'}
        </button>
      ) : null}
      {error ? <p className="text-[#fb7185] text-[11px]" role="alert">{error}</p> : null}

      <button
        type="button"
        className="flex w-full min-h-11 items-center gap-2 text-sm text-[#eef3fb]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>פירוט תכונות</span>
        <span className="ms-auto tabular-nums rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-[#b8c4dc]">{summary.evidenceCount}</span>
        <ChevronDown className={`h-4 w-4 text-[#5a688c] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && detail.data ? (
        <div className="space-y-4" data-testid="person-traits-detail">
          {detail.data.shown.map((trait) => (
            <div key={trait.id} className="space-y-1">
              <p className="text-sm font-semibold text-[#eef3fb]">{trait.label}</p>
              <p className="text-sm text-[#b8c4dc] leading-relaxed">{trait.reasoning}</p>
              <p className="text-[11px] text-[#5a688c]">{trait.supportCount} שיחות</p>
              <ul className="space-y-1">
                {trait.evidence.map((ev) => (
                  <li key={ev.observationId} className="text-xs text-[#b8c4dc]">
                    {ev.href ? (
                      <a href={ev.href} className="hover:text-[#eef3fb]">
                        {SOURCE_LABEL[ev.sourceKind] ?? ev.sourceKind} · {shortDay(ev.sourceDate)}
                        {ev.quote ? ` · "${ev.quote}"` : ''}
                      </a>
                    ) : (
                      <span>
                        {SOURCE_LABEL[ev.sourceKind] ?? ev.sourceKind} · {shortDay(ev.sourceDate)}
                        {ev.quote ? ` · "${ev.quote}"` : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn-ghost text-[11px]" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ traitId: trait.id })}>
                הסתר תכונה
              </button>
            </div>
          ))}
          {detail.data.once.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-[11px] text-[#5a688c]">נראה פעם אחת ({detail.data.once.length})</summary>
              <ul className="mt-2 space-y-2">
                {detail.data.once.map((trait) => (
                  <li key={trait.id} className="text-xs text-[#b8c4dc]">
                    <span className="font-semibold text-[#eef3fb]">{trait.label}</span>
                    {trait.evidence[0] ? ` · ${SOURCE_LABEL[trait.evidence[0].sourceKind] ?? ''} · ${shortDay(trait.evidence[0].sourceDate)}` : ''}
                    {trait.evidence[0]?.quote ? ` · "${trait.evidence[0].quote}"` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {summary.hasSources ? (
            <button type="button" className="btn-ghost text-[11px]" disabled={write.isPending} onClick={run}>
              {write.isPending ? 'מנתח…' : 'נתח שוב'}
            </button>
          ) : null}
        </div>
      ) : null}

      {undo ? (
        <p className="text-[11px] text-[#b8c4dc]" role="status">
          התכונה הוסתרה ·{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => restore.mutate({ traitId: undo })}>בטל</button>
        </p>
      ) : null}
    </div>
  )
}
