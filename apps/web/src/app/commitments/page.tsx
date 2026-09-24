'use client'

import { useState } from 'react'
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

function createdLabel(iso: string): string {
  return format(new Date(iso), 'dd/MM')
}

function dateLabel(iso: string | null): string {
  return iso ? format(new Date(`${iso}T00:00:00`), 'dd/MM') : ''
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function CommitmentsPage() {
  const utils = trpc.useUtils()
  const [owner, setOwner] = useState<OwnerFilter>('all')
  const { data: items = [], isLoading } = trpc.commitments.listProposed.useQuery({ owner })
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [lastAccepted, setLastAccepted] = useState<string | null>(null)

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
          אין התחייבויות ממתינות. הן מגיעות מסיכומי פגישות, מוואטסאפ פרטי, מאימייל ומהקלטות.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="commitments-list">
          {items.map((c) => (
            <li key={c.id} className="card p-3 text-sm" data-testid="commitment-row">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[#0e1626] shrink-0"
                  style={{ background: c.personColor ?? '#e8c547' }}
                  aria-hidden
                >
                  {c.personName.slice(0, 1)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#5a688c]">
                    <CommitmentSourceBadge source={c.source} />
                    <span className="text-[#b8c4dc] font-medium">{c.personName}</span>
                    <span>· {c.owner === 'me' ? 'עליי' : 'עליו/ה'}</span>
                    {c.source === 'voice' && <span>· מהקלטה ב-{createdLabel(c.createdAt)}</span>}
                    {c.dueInferred && <span className="tabular-nums">· עד {dateLabel(c.dueInferred)}</span>}
                  </div>
                  <p className="text-[#eef3fb] mt-0.5">{c.content}</p>
                  {c.sourceSnippet && (
                    <p className="text-xs text-[#97a4c2] mt-1 line-clamp-2" style={{ borderInlineStart: '2px solid #223052', paddingInlineStart: 8 }}>
                      {c.sourceSnippet}
                    </p>
                  )}
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
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" className="btn btn-primary text-xs py-1 px-3 inline-flex items-center gap-1" onClick={() => startAccept(c)}>
                      <Check className="w-3.5 h-3.5" aria-hidden />
                      קבל
                    </button>
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
          ))}
        </ul>
      )}
    </div>
  )
}
