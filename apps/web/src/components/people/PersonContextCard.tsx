'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { MessageCircle, Users, CheckSquare, FileText, Link2, X, Pin, Handshake, Mail, Mic, ExternalLink, Play } from 'lucide-react'
import { CONTACT_CHANNEL_LABELS } from '@ak-system/types'
import { trpc } from '@/lib/trpc'
import { WarmthBadge } from '@/components/relationship/WarmthBadge'
import { CommitmentSourceBadge } from '@/components/commitments/CommitmentSourceBadge'
import { PersonTraits } from './PersonTraits'

const SINCE_SHOWN = 5

function durationLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const VOICE_STATUS: Record<string, string> = {
  uploaded: 'ממתין לעיבוד',
  processing: 'מתמלל ומנתח…',
  failed: 'הניתוח נכשל',
}

function tsLabel(ts: number): string {
  return format(new Date(ts), 'dd/MM HH:mm')
}

function dateLabel(date: string | null): string {
  return date ? format(new Date(date + (date.length === 10 ? 'T00:00:00' : '')), 'dd/MM/yy') : ''
}

interface Snippet {
  id: string
  channel: 'group' | 'dm'
  groupName: string | null
  fromMe: boolean
  text: string
  ts: number
  pinned: boolean
}

const EXPIRED = '[expired]'

interface MailThread {
  id: string
  subject: string
  date: string
  snippet: string | null
  messageCount: number
  fromMe: boolean
  gmailUrl: string | null
}

/** WhatsApp and email on one time line, newest first — both are just ways we talked. */
type TimelineItem = { kind: 'wa'; ts: number; m: Snippet } | { kind: 'mail'; ts: number; t: MailThread }

function mergeTimeline(whatsapp: Snippet[], mail: MailThread[]): TimelineItem[] {
  return [
    ...whatsapp.map((m) => ({ kind: 'wa' as const, ts: m.ts, m })),
    ...mail.map((t) => ({ kind: 'mail' as const, ts: new Date(t.date).getTime(), t })),
  ].sort((a, b) => b.ts - a.ts)
}

function MailItem({ t, muted }: { t: MailThread; muted?: boolean }) {
  return (
    <li className={muted ? 'text-[#97a4c2]' : 'text-[#b8c4dc]'} data-testid="person-email-thread">
      <div className="flex items-center gap-1.5">
        <span className="text-[#5a688c] tabular-nums shrink-0">{tsLabel(new Date(t.date).getTime())}</span>
        <span className="pill text-[10px] py-0 inline-flex items-center gap-1 shrink-0" data-testid="snippet-source-email">
          <Mail className="w-2.5 h-2.5" aria-hidden />
          מייל
        </span>
        <span className="text-[#5a688c] shrink-0">· {t.fromMe ? 'ממני' : 'אליי'}</span>
        <span className="truncate font-medium">{t.subject}</span>
        {t.messageCount > 1 && <span className="text-[#5a688c] shrink-0">· {t.messageCount}</span>}
        {t.gmailUrl && (
          <a
            href={t.gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ms-auto shrink-0 rounded p-0.5 text-[#5a688c] hover:text-[#eef3fb] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547]"
            aria-label={`פתח ב-Gmail: ${t.subject}`}
            title="פתח ב-Gmail"
          >
            <ExternalLink className="w-3 h-3" aria-hidden />
          </a>
        )}
      </div>
      {t.snippet && <p className="leading-relaxed line-clamp-2 text-[#97a4c2]">{t.snippet}</p>}
    </li>
  )
}

function SnippetItem({ m, muted, onPin, pinning }: { m: Snippet; muted?: boolean; onPin: (m: Snippet) => void; pinning: boolean }) {
  const expired = m.text === EXPIRED
  return (
    <li className={`group ${muted ? 'text-[#97a4c2]' : 'text-[#b8c4dc]'}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[#5a688c] tabular-nums">{tsLabel(m.ts)}</span>
        {m.channel === 'dm' ? (
          <span className="pill text-[10px] py-0" data-testid="snippet-source-dm">פרטי</span>
        ) : (
          m.groupName && <span className="text-[#5a688c] truncate">· {m.groupName}</span>
        )}
        {m.channel === 'dm' && m.fromMe && <span className="text-[#5a688c]">· אני</span>}
        {!expired && (
          <button
            type="button"
            className={`ms-auto rounded p-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547] ${
              m.pinned ? 'text-[#e8c547]' : 'text-[#5a688c] hover:text-[#eef3fb] [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus:opacity-100'
            }`}
            aria-label={m.pinned ? 'בטל נעיצה' : 'נעץ · ההודעה לא תימחק'}
            title={m.pinned ? 'נעוץ · לא יימחק' : 'נעץ כדי לשמור אחרי תקופת השמירה'}
            aria-pressed={m.pinned}
            disabled={pinning}
            onClick={() => onPin(m)}
          >
            <Pin className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
      <p className={`leading-relaxed line-clamp-2 ${expired ? 'italic text-[#5a688c]' : ''}`}>
        {expired ? 'ההודעה נמחקה לפי מדיניות השמירה' : m.text}
      </p>
    </li>
  )
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
 * Person card, ordered: recommendation → open loops → commitments to confirm → 1:1 summary →
 * WhatsApp and email since the last Notion meeting → Notion meetings → older WhatsApp and email
 * (collapsed) → voice recordings → circles → capture, WhatsApp senders and email addresses.
 */
export function PersonContextCard({ personId }: { personId: string }) {
  const utils = trpc.useUtils()
  const { data: ctx } = trpc.insights.personContext.useQuery({ personId })
  const [showAllSince, setShowAllSince] = useState(false)
  const [linking, setLinking] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [senderQuery, setSenderQuery] = useState('')
  const [addingEmail, setAddingEmail] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [emailAdded, setEmailAdded] = useState(false)
  const senders = trpc.insights.whatsappSenders.useQuery({ query: senderQuery }, { enabled: linking })
  const invalidate = () => {
    utils.insights.personContext.invalidate({ personId })
    utils.insights.whatsappSenders.invalidate()
  }
  const link = trpc.insights.linkWhatsappSender.useMutation({ onSuccess: () => { invalidate(); setLinking(false) } })
  const unlink = trpc.insights.unlinkWhatsappSender.useMutation({ onSuccess: invalidate })
  const pin = trpc.whatsapp.dm.pin.useMutation({ onSuccess: invalidate })
  const capture = trpc.people.setCaptureWhatsapp.useMutation({
    onSuccess: () => {
      invalidate()
      utils.people.invalidate()
    },
  })
  const addEmail = trpc.people.emails.add.useMutation({
    onSuccess: () => {
      invalidate()
      setEmailDraft('')
      setAddingEmail(false)
      setEmailAdded(true)
    },
  })
  const removeEmail = trpc.people.emails.remove.useMutation({ onSuccess: invalidate })
  const onPin = (m: Snippet) => pin.mutate({ messageId: m.id, pinned: !m.pinned })

  if (!ctx) return null
  const cutoff = ctx.lastNotionMeetingDate ? new Date(`${ctx.lastNotionMeetingDate}T23:59:59`).getTime() : 0
  const sinceAll = mergeTimeline(ctx.whatsappSinceMeeting, ctx.emailThreads.filter((t) => new Date(t.date).getTime() > cutoff))
  const olderAll = mergeTimeline(ctx.olderWhatsapp, ctx.emailThreads.filter((t) => new Date(t.date).getTime() <= cutoff))
  const since = showAllSince ? sinceAll : sinceAll.slice(0, SINCE_SHOWN)
  const renderItem = (item: TimelineItem, muted?: boolean) =>
    item.kind === 'wa'
      ? <SnippetItem key={item.m.id} m={item.m} muted={muted} onPin={onPin} pinning={pin.isPending} />
      : <MailItem key={item.t.id} t={item.t} muted={muted} />

  return (
    <section className="mb-5" data-testid="person-context-card">
      <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">הקשר</h3>
      <div className="card p-3 space-y-4 text-xs">
        <div data-testid="person-traits-block">
          <h4 className="text-[11px] font-semibold text-[#5a688c] mb-1.5">אופי</h4>
          <PersonTraits personId={personId} summary={ctx.traits} />
        </div>
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

        {ctx.proposedCommitments.length > 0 && (
          <div data-testid="person-commitments">
            <SubHeading icon={Handshake}>התחייבויות לאישור ({ctx.proposedCommitments.length})</SubHeading>
            <ul className="space-y-1">
              {ctx.proposedCommitments.slice(0, 3).map((c) => (
                <li key={c.id} className="flex items-baseline gap-2 text-[#b8c4dc]">
                  <CommitmentSourceBadge source={c.source} />
                  <span className="text-[#5a688c] shrink-0">{c.owner === 'me' ? 'עליי' : 'עליו/ה'}</span>
                  <span className="min-w-0">{c.content}</span>
                  {c.dueInferred && <span className="text-[#5a688c] shrink-0 tabular-nums">{dateLabel(c.dueInferred)}</span>}
                </li>
              ))}
            </ul>
            <a href="/commitments" className="btn-ghost text-[11px] mt-1 inline-block">לאישור או דחייה</a>
          </div>
        )}

        {ctx.latestDmSummary && (
          <div data-testid="person-dm-summary">
            <SubHeading icon={MessageCircle}>סיכום השיחה הפרטית · {tsLabel(ctx.latestDmSummary.toTs)}</SubHeading>
            <p className="text-[#b8c4dc] leading-relaxed">{ctx.latestDmSummary.summary}</p>
          </div>
        )}

        {sinceAll.length > 0 && (
          <div data-testid="person-timeline">
            <SubHeading icon={MessageCircle}>
              {ctx.lastNotionMeetingDate ? `התכתבות מאז הפגישה ב-${dateLabel(ctx.lastNotionMeetingDate)}` : 'התכתבות אחרונה'}
            </SubHeading>
            <ul className="space-y-1.5">{since.map((item) => renderItem(item))}</ul>
            {sinceAll.length > SINCE_SHOWN && (
              <button type="button" className="btn-ghost text-[11px] mt-1" onClick={() => setShowAllSince((v) => !v)}>
                {showAllSince ? 'הצג פחות' : `הצג עוד ${sinceAll.length - SINCE_SHOWN}`}
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

        {olderAll.length > 0 && (
          <details data-testid="person-timeline-older">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#5a688c]">
              התכתבות ישנה יותר ({olderAll.length})
            </summary>
            <ul className="space-y-1.5 mt-1.5">{olderAll.map((item) => renderItem(item, true))}</ul>
          </details>
        )}

        {ctx.voiceRecordings.length > 0 && (
          <div data-testid="person-voice-recordings">
            <SubHeading icon={Mic}>הקלטות קוליות</SubHeading>
            <ul className="space-y-1.5">
              {ctx.voiceRecordings.map((r) => (
                <li key={r.id} className="text-[#b8c4dc]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#5a688c] tabular-nums shrink-0">{tsLabel(new Date(r.createdAt).getTime())}</span>
                    <span className="text-[#5a688c] tabular-nums shrink-0">· {durationLabel(r.duration)}</span>
                    <span className="truncate">{r.status === 'completed' ? r.topic ?? r.meetingTitle : VOICE_STATUS[r.status] ?? r.status}</span>
                    <span className="ms-auto flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        className="rounded p-0.5 text-[#5a688c] hover:text-[#eef3fb] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547]"
                        aria-label={playing === r.id ? 'הסתר נגן' : 'השמע הקלטה'}
                        aria-expanded={playing === r.id}
                        onClick={() => setPlaying((id) => (id === r.id ? null : r.id))}
                      >
                        <Play className="w-3 h-3" aria-hidden />
                      </button>
                      {r.meetingId && r.status === 'completed' && (
                        <a href={`/meetings/${r.meetingId}`} className="btn-ghost text-[11px]">לסיכום</a>
                      )}
                    </span>
                  </div>
                  {playing === r.id && (
                    <audio controls autoPlay preload="none" src={`/api/voice/${r.id}/audio`} className="w-full h-8 mt-1" />
                  )}
                </li>
              ))}
            </ul>
          </div>
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
            {ctx.lastContactAt && (
              <>
                קשר אחרון: {dateLabel(ctx.lastContactAt)}
                {ctx.lastContactChannel ? ` (${CONTACT_CHANNEL_LABELS[ctx.lastContactChannel]})` : ''} ·{' '}
              </>
            )}
            {ctx.meetingCount} פגישות · {ctx.sharedProjects.length} פרויקטים משותפים
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={ctx.captureWhatsapp}
              data-testid="capture-whatsapp-toggle"
              disabled={capture.isPending || (!ctx.captureWhatsapp && !ctx.captureReachable)}
              onClick={() => capture.mutate({ id: personId, enabled: !ctx.captureWhatsapp })}
              className="inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-[#b8c4dc] disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#e8c547]"
            >
              <span
                className={`relative inline-block h-4 w-7 rounded-full transition-colors ${ctx.captureWhatsapp ? 'bg-[#e8c547]' : 'bg-[#223052]'}`}
                aria-hidden
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-[#0e1626] transition-all ${ctx.captureWhatsapp ? 'start-3.5' : 'start-0.5'}`}
                />
              </span>
              תיעוד וואטסאפ 1:1
            </button>
            <span className="text-[#5a688c]">
              {ctx.captureWhatsapp
                ? 'הודעות חדשות בצ׳אט הפרטי נשמרות בכרטיס'
                : ctx.captureReachable
                  ? 'כבוי · שום הודעה פרטית לא נשמרת'
                  : 'צריך טלפון או שולח מקושר כדי לזהות את הצ׳אט'}
            </span>
            {capture.error && <span className="text-red-400">{capture.error.message}</span>}
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
            <button
              type="button"
              className="btn-ghost text-[11px] inline-flex items-center gap-1"
              aria-expanded={addingEmail}
              onClick={() => { setAddingEmail((v) => !v); addEmail.reset(); setEmailAdded(false) }}
              data-testid="add-email-toggle"
            >
              <Mail className="w-3 h-3" aria-hidden />
              קשר מייל
            </button>
            <a href={`/voice?person=${personId}`} className="btn-ghost text-[11px] inline-flex items-center gap-1" data-testid="record-conversation-link">
              <Mic className="w-3 h-3" aria-hidden />
              הקלט שיחה
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="person-email-addresses">
            {ctx.emailAddresses.map((e) => (
              <span key={e.address} className="pill text-[10px] inline-flex items-center gap-1" title={e.source === 'primary' ? 'כתובת ראשית' : 'כתובת מקושרת'}>
                <Mail className="w-3 h-3" aria-hidden />
                <span dir="ltr">{e.address}</span>
                <button
                  type="button"
                  aria-label={`הסר כתובת ${e.address}`}
                  title="זו לא הכתובת שלו/ה"
                  disabled={removeEmail.isPending}
                  onClick={() => removeEmail.mutate({ personId, address: e.address })}
                  className="text-[#5a688c] hover:text-[#eef3fb]"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {ctx.emailAddresses.length === 0 && !addingEmail && (
              <span className="text-[#5a688c]">אין כתובת מייל · בלי כתובת המיילים לא נקשרים לכרטיס</span>
            )}
            {emailAdded && <span className="text-[#5a688c]">נשמר · Gmail מתעדכן עכשיו, מייל עבודה תוך כרבע שעה</span>}
          </div>
          {addingEmail && (
            <form
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (emailDraft.trim()) addEmail.mutate({ personId, address: emailDraft.trim() })
              }}
            >
              <input
                className="input flex-1 min-w-[12rem] text-xs"
                type="email"
                dir="ltr"
                aria-label="כתובת מייל"
                placeholder="name@company.com"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                autoFocus
              />
              <button type="submit" className="btn btn-primary text-xs" disabled={addEmail.isPending || !emailDraft.trim()}>
                הוסף
              </button>
              {addEmail.error && <span className="text-red-400 w-full">{addEmail.error.message}</span>}
            </form>
          )}
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
