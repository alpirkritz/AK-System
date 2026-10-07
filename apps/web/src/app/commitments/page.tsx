'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Check, ExternalLink, X } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { CommitmentSourceBadge } from '@/components/commitments/CommitmentSourceBadge'

type OwnerFilter = 'all' | 'me' | 'them'

const FILTERS: { id: OwnerFilter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'me', label: 'שלי' },
  { id: 'them', label: 'שלהם' },
]

const SOURCE_LINK_LABELS: Record<string, string> = {
  meeting_analysis: 'לסיכום הפגישה',
  email: 'פתח ב-Gmail',
  voice: 'להקלטה',
}

/**
 * When the conversation happened, not when the scan ran. Recent times read as "לפני X" so a
 * backfilled message from this morning is obvious at a glance.
 */
function sourceTimeLabel(ms: number, now: number | null): string {
  // Until the client clock is available, render the absolute time so SSR and hydration agree.
  if (now == null) return format(new Date(ms), 'dd/MM HH:mm')
  const minutes = Math.round((now - ms) / 60_000)
  if (minutes < 1) return 'עכשיו'
  if (minutes < 60) return `לפני ${minutes} דק׳`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  const date = new Date(ms)
  return hours < 48 ? `אתמול ${format(date, 'HH:mm')}` : format(date, 'dd/MM HH:mm')
}

function dateLabel(iso: string | null): string {
  return iso ? format(new Date(`${iso}T00:00:00`), 'dd/MM') : ''
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function senderLabel(name: string | null): string | null {
  if (!name || /@(lid|s\.whatsapp\.net|g\.us)$/.test(name)) return null
  return name
}

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null
  const match = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid)
  if (!match) return null
  const digits = match[1]
  if (digits.startsWith('972') && digits.length > 3) return `0${digits.slice(3)}`
  return digits
}

/** Collapsed by default; the surrounding messages are only fetched once the user asks for them. */
function CommitmentContext({ commitmentId }: { commitmentId: string }) {
  const [open, setOpen] = useState(false)
  const { data, isPending } = trpc.commitments.sourceContext.useQuery({ commitmentId }, { enabled: open })

  return (
    <div className="mt-1">
      <button
        type="button"
        className="btn-ghost text-[11px]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="commitment-context-toggle"
      >
        {open ? 'הסתר הקשר' : 'הצג הקשר'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-md border border-[#223052] bg-[#131c33] p-2" data-testid="commitment-context">
          {isPending ? (
            <p className="text-xs text-[#5a688c]">טוען הקשר…</p>
          ) : !data || data.messages.length === 0 ? (
            <p className="text-xs text-[#5a688c]">ההודעות המקוריות כבר לא נשמרות.</p>
          ) : (
            data.messages.map((m) => (
              <p key={m.id} className={`text-xs ${m.isSource ? 'text-[#eef3fb]' : 'text-[#97a4c2]'}`}>
                <span className="text-[#5a688c] tabular-nums">{format(new Date(m.ts), 'HH:mm')} </span>
                <span className="font-medium">{m.speaker}: </span>
                {m.text}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function CommitmentsPage() {
  const utils = trpc.useUtils()
  const [owner, setOwner] = useState<OwnerFilter>('all')
  const { data: items = [], isLoading } = trpc.commitments.listProposed.useQuery({ owner })
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [personQuery, setPersonQuery] = useState('')
  const { data: contacts = [] } = trpc.people.list.useQuery(undefined, { enabled: linkingId != null })
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [lastAccepted, setLastAccepted] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [items])

  const refresh = () => {
    utils.commitments.listProposed.invalidate()
    utils.insights.personContext.invalidate()
  }
  const accept = trpc.commitments.accept.useMutation({
    onSuccess: (res) => {
      setEditingId(null)
      setLastAccepted(res.notionSynced ? 'נוצרה משימה ונשלחה לנושן' : 'נוצרה משימה')
      utils.tasks.list.invalidate()
      refresh()
    },
  })
  const dismiss = trpc.commitments.dismiss.useMutation({ onSuccess: refresh })
  const saveContact = trpc.commitments.saveUnknownContact.useMutation({ onSuccess: refresh })
  const linkContact = trpc.commitments.linkUnknownContact.useMutation({
    onSuccess: () => {
      setLinkingId(null)
      setPersonQuery('')
      refresh()
    },
  })
  const contactMatches = contacts
    .filter((p) => !personQuery.trim() || p.name.includes(personQuery.trim()))
    .slice(0, 8)

  const startAccept = (c: (typeof items)[number]) => {
    setEditingId(c.id)
    setTitle(c.content)
    setDueDate(c.dueInferred ?? todayIso())
    setWorkspaceId('')
    setLastAccepted(null)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-lg font-semibold text-[#eef3fb]">התחייבויות לאישור</h1>
        {items.length > 0 && <span className="pill">{items.length}</span>}
        <div className="flex gap-1 ms-auto" role="tablist" aria-label="סינון לפי אחראי">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={owner === f.id}
              className={`btn text-xs py-1 px-3 ${owner === f.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setOwner(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {lastAccepted && (
        <p className="text-xs text-[#2dd4bf] mb-3" role="status">
          {lastAccepted} · <Link href="/tasks" className="underline">למשימות</Link>
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-[#5a688c]">טוען…</p>
      ) : items.length === 0 ? (
        <div className="card text-sm text-[#97a4c2]" data-testid="commitments-empty">
          אין התחייבויות ממתינות. הן מגיעות מסיכומי פגישות, מוואטסאפ פרטי, מקבוצות וואטסאפ במעקב, מאימייל ומהקלטות.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="commitments-list">
          {items.map((c) => {
            const unknown = !c.personId
            const phone = unknown ? phoneFromJid(c.senderJid) : null
            const unknownDetail = [senderLabel(c.senderName), phone].filter(Boolean).join(' · ')
            return (
            <li key={c.id} className="card p-3 text-sm" data-testid="commitment-row">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[#0e1626] shrink-0"
                  style={{ background: c.personColor ?? '#e8c547' }}
                  aria-hidden
                >
                  {(c.personName ?? '?').slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#5a688c]">
                    <CommitmentSourceBadge source={c.source} />
                    <span className="text-[#b8c4dc] font-medium">{unknown ? 'התחייבות ממספר לא מוכר' : c.personName}</span>
                    <span>· {c.owner === 'me' ? 'עליי' : 'עליו/ה'}</span>
                    {c.sourceChatName && <span>· {c.sourceChatName}</span>}
                    <span className="tabular-nums" title={new Date(c.sourceTs ?? c.createdAt).toLocaleString('he-IL')}>
                      · {sourceTimeLabel(new Date(c.sourceTs ?? c.createdAt).getTime(), now)}
                    </span>
                    {c.dueInferred && <span className="tabular-nums">· עד {dateLabel(c.dueInferred)}</span>}
                  </div>
                  {unknown && unknownDetail && (
                    <p className="text-xs text-[#97a4c2] mt-0.5">{unknownDetail}</p>
                  )}
                  <p className="text-[#eef3fb] mt-0.5">{c.content}</p>
                  {c.sourceSnippet && (
                    <p className="text-xs text-[#97a4c2] mt-1 line-clamp-2" style={{ borderInlineStart: '2px solid #223052', paddingInlineStart: 8 }}>
                      {c.sourceSnippet}
                    </p>
                  )}
                  {c.sourceReason && <p className="text-xs text-[#5a688c] mt-1">למה: {c.sourceReason}</p>}
                  {c.sourceTs != null && <CommitmentContext commitmentId={c.id} />}
                  {c.sourceUrl && (
                    <a
                      href={c.sourceUrl}
                      {...(c.source === 'email' ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="btn-ghost text-[11px] mt-1 inline-flex items-center gap-1"
                      data-testid="commitment-source-link"
                    >
                      {c.source === 'email' && <ExternalLink className="w-3 h-3" aria-hidden />}
                      {SOURCE_LINK_LABELS[c.source] ?? 'למקור'}
                    </a>
                  )}
                </div>
                {editingId !== c.id && (
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {!unknown && (
                      <button type="button" className="btn btn-primary text-xs py-1 px-3 inline-flex items-center gap-1" onClick={() => startAccept(c)}>
                        <Check className="w-3.5 h-3.5" aria-hidden />
                        קבל
                      </button>
                    )}
                    {unknown && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary text-xs py-1 px-3"
                          disabled={saveContact.isPending}
                          onClick={() => saveContact.mutate({ commitmentId: c.id })}
                        >
                          שמור לאנשי קשר
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs py-1 px-3"
                          onClick={() => {
                            setLinkingId(linkingId === c.id ? null : c.id)
                            setPersonQuery('')
                          }}
                        >
                          שייך לאיש קשר קיים
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost text-xs py-1 px-3 inline-flex items-center gap-1"
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate({ commitmentId: c.id })}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                      דחה
                    </button>
                  </div>
                )}
              </div>

              {unknown && linkingId === c.id && (
                <div className="mt-3 pt-3 border-t border-[#223052]">
                  <label className="sr-only" htmlFor={`link-${c.id}`}>חיפוש איש קשר</label>
                  <input
                    id={`link-${c.id}`}
                    className="input text-sm"
                    placeholder="חיפוש איש קשר"
                    value={personQuery}
                    onChange={(e) => setPersonQuery(e.target.value)}
                    autoFocus
                  />
                  <ul className="mt-2 space-y-1">
                    {contactMatches.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs py-1 px-3 w-full text-start"
                          disabled={linkContact.isPending}
                          onClick={() => linkContact.mutate({ commitmentId: c.id, personId: p.id })}
                        >
                          {p.name}
                        </button>
                      </li>
                    ))}
                    {contactMatches.length === 0 && <li className="text-xs text-[#5a688c]">אין אנשי קשר תואמים</li>}
                  </ul>
                  {(saveContact.error || linkContact.error) && (
                    <p className="text-xs text-red-400 mt-2">{(saveContact.error ?? linkContact.error)?.message}</p>
                  )}
                </div>
              )}

              {editingId === c.id && (
                <form
                  className="mt-3 pt-3 border-t border-[#223052] grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
                  onSubmit={(e) => {
                    e.preventDefault()
                    accept.mutate({
                      commitmentId: c.id,
                      taskTitle: title.trim() || undefined,
                      taskDueDate: dueDate || null,
                      taskWorkspaceId: workspaceId || null,
                    })
                  }}
                >
                  <label className="sr-only" htmlFor={`title-${c.id}`}>כותרת המשימה</label>
                  <input id={`title-${c.id}`} className="input text-sm" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                  <label className="sr-only" htmlFor={`due-${c.id}`}>תאריך יעד</label>
                  <input id={`due-${c.id}`} type="date" className="input text-sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  <label className="sr-only" htmlFor={`ws-${c.id}`}>סביבת עבודה</label>
                  <select id={`ws-${c.id}`} className="input text-sm" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                    <option value="">ללא סביבת עבודה</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    <button type="submit" className="btn btn-primary text-xs py-1 px-3" disabled={accept.isPending || !title.trim()}>
                      {accept.isPending ? 'יוצר…' : 'צור משימה'}
                    </button>
                    <button type="button" className="btn btn-ghost text-xs py-1 px-3" onClick={() => setEditingId(null)}>
                      ביטול
                    </button>
                  </div>
                  {accept.error && <p className="text-xs text-red-400 sm:col-span-4">{accept.error.message}</p>}
                </form>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
