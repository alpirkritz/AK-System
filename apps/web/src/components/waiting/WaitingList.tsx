'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Check } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { commitmentSourceLabel } from '@/components/commitments/CommitmentSourceBadge'

export type WaitingItem = {
  kind: 'task' | 'commitment'
  id: string
  title: string
  personId: string
  personName: string
  personColor: string | null
  dueDate: string | null
  source: string
  sourceLabel: string | null
  meetingId: string | null
}

export type WaitingBuckets = {
  overdue: WaitingItem[]
  today: WaitingItem[]
  thisWeek: WaitingItem[]
  later: WaitingItem[]
  noDate: WaitingItem[]
}

export type WaitingView = 'today' | 'person' | 'time'

export const SECTION_LABELS: { key: keyof WaitingBuckets; label: string; tone: string }[] = [
  { key: 'overdue', label: 'באיחור', tone: '#e57373' },
  { key: 'today', label: 'להיום', tone: '#e8c547' },
  { key: 'thisWeek', label: 'השבוע', tone: '#97a4c2' },
  { key: 'later', label: 'אחר כך', tone: '#97a4c2' },
  { key: 'noDate', label: 'בלי תאריך', tone: '#5a688c' },
]

export const flattenWaiting = (b: WaitingBuckets): WaitingItem[] =>
  SECTION_LABELS.flatMap((s) => b[s.key])

/** Items due today first, then the ones already late: the "who owes me what today" set. */
export const dueNow = (b: WaitingBuckets): WaitingItem[] => [...b.today, ...b.overdue]

const SOURCE_NAMES: Record<string, string> = { meeting: 'פגישה', manual: 'ידני', notion: 'Notion' }
const sourceName = (s: string) => SOURCE_NAMES[s] ?? commitmentSourceLabel(s)

const dueLabel = (d: string | null) => (d ? format(new Date(`${d.slice(0, 10)}T12:00:00`), 'd.M') : null)

/** Groups items by person, keeping the order in which each person first appears. */
export function groupByPerson(items: WaitingItem[]): { personId: string; personName: string; items: WaitingItem[] }[] {
  const map = new Map<string, { personId: string; personName: string; items: WaitingItem[] }>()
  for (const item of items) {
    const g = map.get(item.personId) ?? { personId: item.personId, personName: item.personName, items: [] }
    g.items.push(item)
    map.set(item.personId, g)
  }
  return [...map.values()]
}

/** Opens a task row in place; without it, task rows link to `/tasks?task=<id>`. */
type OpenTask = (taskId: string) => void

export function WaitingRow({
  item, showPerson = true, overdue = false, onOpenTask,
}: { item: WaitingItem; showPerson?: boolean; overdue?: boolean; onOpenTask?: OpenTask }) {
  const utils = trpc.useUtils()
  const complete = trpc.waiting.complete.useMutation({
    onSuccess: () => {
      void utils.waiting.list.invalidate()
      void utils.tasks.list.invalidate()
      void utils.commitments.invalidate()
    },
  })
  const due = dueLabel(item.dueDate)
  const title = item.kind === 'task'
    ? onOpenTask
      ? <button type="button" className="text-right hover:text-white" title="פתח משימה" onClick={() => onOpenTask(item.id)}>{item.title}</button>
      : <Link href={`/tasks?task=${item.id}`} className="hover:text-white" title="פתח משימה">{item.title}</Link>
    : item.meetingId
    ? <Link href={`/meetings/${item.meetingId}`} className="hover:text-white">{item.title}</Link>
    : <span>{item.title}</span>
  return (
    <li className="flex items-start gap-2 py-1.5" data-testid="waiting-row">
      <button
        type="button"
        aria-label={`סמן כבוצע: ${item.title}`}
        className="mt-0.5 w-5 h-5 shrink-0 rounded-md border border-[#3a4b73] hover:border-[#2dd4bf] hover:text-[#2dd4bf] text-transparent flex items-center justify-center"
        disabled={complete.isPending}
        onClick={() => complete.mutate({ kind: item.kind, id: item.id })}
      >
        <Check size={13} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-[#eef3fb] leading-snug">{title}</div>
        <div className="text-[11px] text-[#5a688c] flex flex-wrap gap-x-2">
          {showPerson && <span className="text-[#97a4c2]">{item.personName}</span>}
          {due && <span className="tabular-nums" style={overdue ? { color: '#e57373' } : undefined}>עד {due}</span>}
          <span>{sourceName(item.source)}{item.sourceLabel ? ` · ${item.sourceLabel}` : ''}</span>
        </div>
      </div>
    </li>
  )
}

function PersonBlocks({ items, overdueIds, onOpenTask }: { items: WaitingItem[]; overdueIds: Set<string>; onOpenTask?: OpenTask }) {
  return (
    <div className="space-y-3">
      {groupByPerson(items).map((g) => (
        <div key={g.personId}>
          <Link href={`/people?person=${g.personId}`} className="text-xs font-semibold text-[#97a4c2] hover:text-white">
            {g.personName}
          </Link>
          <ul>
            {g.items.map((i) => (
              <WaitingRow key={`${i.kind}-${i.id}`} item={i} showPerson={false} overdue={overdueIds.has(i.id)} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** What is due today comes first; the late ones sit below, folded, so a long backlog cannot bury today. */
function TodayView({ buckets, overdueIds, onOpenTask }: { buckets: WaitingBuckets; overdueIds: Set<string>; onOpenTask?: OpenTask }) {
  const [showLate, setShowLate] = useState(false)
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#e8c547' }}>
          להיום ({buckets.today.length})
        </h3>
        {buckets.today.length === 0 ? (
          <p className="text-sm text-[#97a4c2]" data-testid="waiting-today-none">אף אחד לא חייב לך משהו להיום</p>
        ) : (
          <PersonBlocks items={buckets.today} overdueIds={overdueIds} onOpenTask={onOpenTask} />
        )}
      </section>
      {buckets.overdue.length > 0 && (
        <section>
          <button
            type="button"
            className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: '#e57373' }}
            aria-expanded={showLate}
            onClick={() => setShowLate((v) => !v)}
            data-testid="waiting-late-toggle"
          >
            <span aria-hidden>{showLate ? '▾' : '◂'}</span>
            באיחור ({buckets.overdue.length})
          </button>
          {showLate && (
            <div className="mt-2">
              <PersonBlocks items={buckets.overdue} overdueIds={overdueIds} onOpenTask={onOpenTask} />
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/** One list, three shapes: today (late + due, by person), by person, or by time. */
export function WaitingView({
  buckets, view, showPerson = true, onOpenTask,
}: { buckets: WaitingBuckets; view: WaitingView; showPerson?: boolean; onOpenTask?: OpenTask }) {
  const overdueIds = new Set(buckets.overdue.map((i) => i.id))
  if (view === 'today') return <TodayView buckets={buckets} overdueIds={overdueIds} onOpenTask={onOpenTask} />
  if (view === 'person') {
    const all = flattenWaiting(buckets)
    const urgent = new Set(dueNow(buckets).map((i) => i.personId))
    const ordered = [...all].sort((a, b) => Number(urgent.has(b.personId)) - Number(urgent.has(a.personId)))
    return <PersonBlocks items={ordered} overdueIds={overdueIds} onOpenTask={onOpenTask} />
  }
  return (
    <div className="space-y-4">
      {SECTION_LABELS.filter((s) => buckets[s.key].length > 0).map((s) => (
        <section key={s.key}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: s.tone }}>
            {s.label}
          </h3>
          <ul>
            {buckets[s.key].map((i) => (
              <WaitingRow key={`${i.kind}-${i.id}`} item={i} showPerson={showPerson} overdue={s.key === 'overdue'} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
