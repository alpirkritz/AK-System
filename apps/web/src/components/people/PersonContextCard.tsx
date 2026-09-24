'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { MessageCircle, Users, CheckSquare, FileText, Link2, X } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { WarmthBadge } from '@/components/relationship/WarmthBadge'

const SINCE_SHOWN = 5

function tsLabel(ts: number): string {
  return format(new Date(ts), 'dd/MM HH:mm')
}

function dateLabel(date: string | null): string {
  return date ? format(new Date(date + (date.length === 10 ? 'T00:00:00' : '')), 'dd/MM/yy') : ''
}

function SubHeading({ icon: Icon, children }: { icon: typeof Users; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#5a688c] mb-1.5">
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {children}
    </h4>
  )
}

/**
 * Person card, ordered: recommendation → open loops → WhatsApp since the last Notion meeting →
 * Notion meetings → older WhatsApp (collapsed) → circles.
 */
export function PersonContextCard({ personId }: { personId: string }) {
  const utils = trpc.useUtils()
  const { data: ctx } = trpc.insights.personContext.useQuery({ personId })
  const [showAllSince, setShowAllSince] = useState(false)
  const [linking, setLinking] = useState(false)
  const [senderQuery, setSenderQuery] = useState('')
  const senders = trpc.insights.whatsappSenders.useQuery({ query: senderQuery }, { enabled: linking })
  const invalidate = () => {
    utils.insights.personContext.invalidate({ personId })
    utils.insights.whatsappSenders.invalidate()
  }
  const link = trpc.insights.linkWhatsappSender.useMutation({ onSuccess: () => { invalidate(); setLinking(false) } })
  const unlink = trpc.insights.unlinkWhatsappSender.useMutation({ onSuccess: invalidate })

  if (!ctx) return null
  const since = showAllSince ? ctx.whatsappSinceMeeting : ctx.whatsappSinceMeeting.slice(0, SINCE_SHOWN)

  return (
    <section className="mb-5" data-testid="person-context-card">
      <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">הקשר</h3>
      <div className="card p-3 space-y-4 text-xs">
        <div className="flex flex-wrap items-start gap-2">
          <p
            className="flex-1 min-w-0 rounded-md px-2.5 py-2 leading-relaxed"
            style={{ background: 'rgba(232,197,71,0.08)', borderInlineStart: '3px solid #e8c547', color: '#eef3fb' }}
            data-testid="person-recommendation"
          >
            {ctx.recommendation ?? 'אין עדיין פגישות מתועדות או הודעות · שווה לתעד את השיחה הבאה'}
          </p>
          <WarmthBadge warmth={ctx.warmth} scope="person" />
        </div>

        {ctx.openLoopsForPerson.length > 0 && (
          <div>
            <SubHeading icon={CheckSquare}>משימות פתוחות ({ctx.openLoopsForPerson.length})</SubHeading>
            <ul className="space-y-1">
              {ctx.openLoopsForPerson.slice(0, 5).map((l, i) => (
                <li key={`${l.meetingId}-${i}`} className="flex gap-2 text-[#b8c4dc]">
                  <span className="text-[#5a688c] shrink-0 tabular-nums">{dateLabel(l.meetingDate)}</span>
                  <a href={`/meetings/${l.meetingId}`} className="hover:text-[#eef3fb]">{l.content}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ctx.whatsappSinceMeeting.length > 0 && (
          <div>
            <SubHeading icon={MessageCircle}>
              {ctx.lastNotionMeetingDate ? `וואטסאפ מאז הפגישה ב-${dateLabel(ctx.lastNotionMeetingDate)}` : 'וואטסאפ אחרון'}
            </SubHeading>
            <ul className="space-y-1.5">
              {since.map((m) => (
                <li key={m.id} className="text-[#b8c4dc]">
                  <span className="text-[#5a688c] tabular-nums">{tsLabel(m.ts)}</span>
                  {m.groupName && <span className="text-[#5a688c]"> · {m.groupName}</span>}
                  <p className="leading-relaxed line-clamp-2">{m.text}</p>
                </li>
              ))}
            </ul>
            {ctx.whatsappSinceMeeting.length > SINCE_SHOWN && (
              <button type="button" className="btn-ghost text-[11px] mt-1" onClick={() => setShowAllSince((v) => !v)}>
                {showAllSince ? 'הצג פחות' : `הצג עוד ${ctx.whatsappSinceMeeting.length - SINCE_SHOWN}`}
              </button>
            )}
          </div>
        )}

        {ctx.recentMeetingNotes.length > 0 && (
          <div>
            <SubHeading icon={FileText}>פגישות בנושן</SubHeading>
            <ul className="space-y-1">
              {ctx.recentMeetingNotes.map((n) => (
                <li key={n.id} className="flex gap-2 text-[#b8c4dc]">
                  <span className="text-[#5a688c] shrink-0 tabular-nums">{dateLabel(n.date)}</span>
                  <span className="truncate">{n.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ctx.olderWhatsapp.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[11px] font-semibold text-[#5a688c]">
              וואטסאפ ישן יותר ({ctx.olderWhatsapp.length})
            </summary>
            <ul className="space-y-1.5 mt-1.5">
              {ctx.olderWhatsapp.map((m) => (
                <li key={m.id} className="text-[#97a4c2]">
                  <span className="text-[#5a688c] tabular-nums">{tsLabel(m.ts)}</span>
                  {m.groupName && <span className="text-[#5a688c]"> · {m.groupName}</span>}
                  <p className="leading-relaxed line-clamp-2">{m.text}</p>
                </li>
              ))}
            </ul>
          </details>
        )}

        {ctx.circles.length > 0 && (
          <div>
            <SubHeading icon={Users}>חוגים</SubHeading>
            <ul className="space-y-1">
              {ctx.circles.map((c) => (
                <li key={c.seriesId} className="text-[#b8c4dc]">
                  {c.seriesTitle}
                  {c.cadence && <span className="text-[#5a688c]"> · {c.cadence === 'weekly' ? 'שבועי' : c.cadence}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-2 border-t border-[#223052] space-y-2">
          <div className="text-[#5a688c]">
            {ctx.lastContactAt && <>קשר אחרון: {dateLabel(ctx.lastContactAt)} · </>}
            {ctx.meetingCount} פגישות · {ctx.sharedProjects.length} פרויקטים משותפים
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {ctx.whatsappSenders.map((s) => (
              <span key={s.jid} className="pill text-[10px] inline-flex items-center gap-1" title={s.jid}>
                <MessageCircle className="w-3 h-3" aria-hidden />
                {s.matchedBy === 'phone' ? 'וואטסאפ לפי טלפון' : 'וואטסאפ מקושר'}
                <button
                  type="button"
                  aria-label={s.matchedBy === 'phone' ? 'זה לא הוא · הפסק לשייך לפי טלפון' : 'בטל קישור וואטסאפ'}
                  title={s.matchedBy === 'phone' ? 'זה לא הוא' : 'בטל קישור'}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate({ personId, jid: s.jid })}
                  className="text-[#5a688c] hover:text-[#eef3fb]"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button type="button" className="btn-ghost text-[11px] inline-flex items-center gap-1" onClick={() => setLinking((v) => !v)}>
              <Link2 className="w-3 h-3" aria-hidden />
              קשר שולח מוואטסאפ
            </button>
          </div>
          {linking && (
            <div className="space-y-1.5">
              <input
                className="input w-full text-xs"
                placeholder="חיפוש לפי שם השולח בקבוצות"
                value={senderQuery}
                onChange={(e) => setSenderQuery(e.target.value)}
                autoFocus
              />
              <ul className="max-h-40 overflow-y-auto space-y-0.5">
                {(senders.data ?? []).map((s) => (
                  <li key={s.jid}>
                    <button
                      type="button"
                      className="w-full text-start px-2 py-1 rounded hover:bg-[#1a2744] text-[#b8c4dc] disabled:opacity-50"
                      disabled={link.isPending}
                      onClick={() => link.mutate({ personId, jid: s.jid })}
                    >
                      {s.senderName || s.jid}
                      <span className="text-[#5a688c]"> · {s.count} הודעות</span>
                    </button>
                  </li>
                ))}
                {senders.data && senders.data.length === 0 && <li className="px-2 py-1 text-[#5a688c]">לא נמצאו שולחים שלא קושרו</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
