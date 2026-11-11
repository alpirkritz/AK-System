'use client'

import { useRef, useState, type ReactNode } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/cn'
import { WaitingView, flattenWaiting, type WaitingBuckets } from '@/components/waiting/WaitingList'
import { PersonContextCard } from './PersonContextCard'

type OpenTask = (taskId: string) => void
type OpenCommitment = Parameters<typeof WaitingView>[0]['onOpenCommitment']

interface Props {
  personId: string
  notes?: string | null
  lastMeeting?: { title: string; date: string } | null
  hasContext: boolean
  /** What they owe me (`waiting.list`), already loaded by the panel. */
  theyOwe?: WaitingBuckets
  theyOweLoading: boolean
  /** Linked tasks that are in neither list, rendered by the panel. */
  sharedTasks: ReactNode
  sharedCount: number
  onOpenTask: OpenTask
  onOpenCommitment: OpenCommitment
}

type Direction = 'iOwe' | 'theyOwe'

function SummaryCard({
  label, count, overdue, tone, loading, onClick, testId,
}: { label: string; count: number; overdue: boolean; tone: string; loading: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="card min-h-[56px] min-w-0 px-3 py-2 text-right flex flex-col justify-center transition-colors hover:border-[#4d659c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8c547]"
      style={{ borderColor: overdue ? '#e57373' : undefined }}
    >
      <span className="text-[11px] text-[#7a89ab] truncate">{label}</span>
      {loading ? (
        <span className="skeleton h-6 w-8 rounded mt-1" />
      ) : (
        <span className="flex items-center gap-1.5 mt-0.5">
          <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: tone }}>{count}</span>
          {overdue && (
            <span className="text-[10px] text-[#e57373] truncate">
              <span aria-hidden>● </span>באיחור
            </span>
          )}
        </span>
      )}
    </button>
  )
}

function QuickAdd({ personId, as, onDone }: { personId: string; as: 'task' | 'commitment'; onDone: () => void }) {
  const utils = trpc.useUtils()
  const [title, setTitle] = useState('')
  const [direction, setDirection] = useState<Direction>(as === 'commitment' ? 'theyOwe' : 'iOwe')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const add = trpc.waiting.quickAdd.useMutation({
    onSuccess: () => {
      setTitle('')
      setError(null)
      void utils.waiting.invalidate()
      void utils.people.getRelated.invalidate({ id: personId })
      void utils.tasks.list.invalidate()
      inputRef.current?.focus()
    },
    onError: () => setError('לא הצלחנו לשמור. נסו שוב.'),
  })

  const submit = () => {
    const value = title.trim()
    if (!value || add.isPending) return
    add.mutate({ personId, title: value, direction, as })
  }

  return (
    <div className="space-y-2" data-testid="person-quick-add">
      {as === 'task' && (
      <div className="flex gap-1.5" role="radiogroup" aria-label="כיוון">
        {([['iOwe', 'אני חייב/ת'], ['theyOwe', 'חייב/ת לי']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            className="filter-chip min-h-[36px]"
            onClick={() => setDirection(value)}
          >
            {label}
          </button>
        ))}
      </div>
      )}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          autoFocus
          className="input text-sm flex-1 min-w-0"
          placeholder={as === 'commitment' ? 'מה הוא/היא התחייב/ה?' : 'מה צריך לעשות?'}
          aria-label={as === 'commitment' ? 'תוכן ההתחייבות' : 'כותרת המשימה'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { e.stopPropagation(); onDone() }
          }}
        />
        <button type="button" className="btn btn-primary min-h-[44px]" disabled={!title.trim() || add.isPending} onClick={submit}>
          {add.isPending ? 'שומר…' : 'הוסף'}
        </button>
      </div>
      {error && <p className="text-xs text-[#e57373]" role="alert">{error}</p>}
    </div>
  )
}

/** The "במפגש" tab: what I owe them, what they owe me, and what is worth knowing, in one screen. */
export function PersonMeetingTab({
  personId, notes, lastMeeting, hasContext, theyOwe, theyOweLoading, sharedTasks, sharedCount, onOpenTask, onOpenCommitment,
}: Props) {
  const owed = trpc.waiting.owedByMe.useQuery({ personId })
  const [adding, setAdding] = useState<null | 'task' | 'commitment'>(null)
  const iOweRef = useRef<HTMLElement>(null)
  const theyOweRef = useRef<HTMLElement>(null)

  if (owed.isError) {
    return (
      <div className="py-6 text-center" role="alert">
        <p className="text-sm text-[#b8c4dc] mb-3">לא הצלחנו לטעון את הנתונים. נסו שוב.</p>
        <button type="button" className="btn btn-ghost" onClick={() => void owed.refetch()}>נסה שוב</button>
      </div>
    )
  }

  const iOweCount = owed.data ? flattenWaiting(owed.data).length : 0
  const theyOweCount = theyOwe ? flattenWaiting(theyOwe).length : 0
  const loading = owed.isLoading || theyOweLoading
  const empty = !loading && iOweCount === 0 && theyOweCount === 0 && sharedCount === 0
  const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const lastMeetingLine = lastMeeting
    ? `פגישה אחרונה: ${lastMeeting.title} · ${format(new Date(lastMeeting.date), 'dd/MM/yy')} (${formatDistanceToNow(new Date(lastMeeting.date), { locale: he, addSuffix: true })})`
    : null

  return (
    <div className="panel-cq pt-1">
      <div className="grid grid-cols-2 gap-2 mb-4">
        <SummaryCard
          testId="person-card-i-owe"
          label="אני חייב/ת"
          count={iOweCount}
          overdue={(owed.data?.overdue.length ?? 0) > 0}
          tone="#e8c547"
          loading={owed.isLoading}
          onClick={() => scrollTo(iOweRef.current)}
        />
        <SummaryCard
          testId="person-card-they-owe"
          label="חייב/ת לי"
          count={theyOweCount}
          overdue={(theyOwe?.overdue.length ?? 0) > 0}
          tone="#2dd4bf"
          loading={theyOweLoading}
          onClick={() => scrollTo(theyOweRef.current)}
        />
      </div>

      {loading && (
        <div className="space-y-2 mb-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-8 rounded" />)}
        </div>
      )}

      {empty && (
        <div className="card p-4 mb-4 text-center" data-testid="person-meeting-empty">
          <p className="text-sm text-[#b8c4dc] mb-3">אין מה לסגור איתו/ה כרגע. אפשר להוסיף משימה או התחייבות.</p>
          <div className="flex justify-center gap-2 flex-wrap">
            <button type="button" className="btn btn-primary min-h-[44px]" onClick={() => setAdding('task')}>+ משימה</button>
          </div>
        </div>
      )}

      <div className="meeting-grid">
        <div className="min-w-0">
          {iOweCount > 0 && owed.data && (
            <section ref={iOweRef} className="mb-5 scroll-mt-2" data-testid="person-i-owe">
              <div className="text-[11px] font-semibold text-[#7a89ab] mb-1">אני חייב/ת · {iOweCount}</div>
              <WaitingView buckets={owed.data} view="time" showPerson={false} onOpenTask={onOpenTask} />
            </section>
          )}
          {theyOweCount > 0 && theyOwe && (
            <section ref={theyOweRef} className="mb-5 scroll-mt-2" data-testid="person-owes-me">
              <div className="text-[11px] font-semibold text-[#7a89ab] mb-1">חייב/ת לי · {theyOweCount}</div>
              <WaitingView buckets={theyOwe} view="time" showPerson={false} onOpenTask={onOpenTask} onOpenCommitment={onOpenCommitment} />
            </section>
          )}
          {sharedCount > 0 && (
            <section className="mb-5">
              <div className="text-[11px] font-semibold text-[#7a89ab] mb-1">משימות משותפות · {sharedCount}</div>
              {sharedTasks}
            </section>
          )}
        </div>

        {(hasContext || notes || lastMeetingLine) && (
          <section className="min-w-0 mb-5" data-testid="person-know">
            <h3 className="text-[11px] font-semibold text-[#5a688c] uppercase tracking-wider mb-2">חשוב לדעת</h3>
            {lastMeetingLine && <p className="text-xs text-[#97a4c2] mb-2">{lastMeetingLine}</p>}
            {notes && <p className="text-sm text-[#b8c4dc] whitespace-pre-wrap leading-relaxed mb-3">{notes}</p>}
            {hasContext && <PersonContextCard personId={personId} />}
          </section>
        )}
      </div>

      {/* Sticky capture bar: stays reachable while the lists scroll, clear of the phone's home indicator. */}
      <div
        className={cn('sticky bottom-0 -mx-6 px-6 pt-3 border-t border-[#2f4368] bg-[#16233b]')}
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        data-testid="person-quick-bar"
      >
        {adding ? (
          <QuickAdd key={adding} personId={personId} as={adding} onDone={() => setAdding(null)} />
        ) : (
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1 min-h-[44px] flex items-center justify-center gap-1.5" onClick={() => setAdding('task')} data-testid="person-add-task">
              <Plus className="w-4 h-4" aria-hidden /> משימה
            </button>
            <button
              type="button"
              className="btn btn-ghost flex-1 min-h-[44px] flex items-center justify-center gap-1.5"
              data-testid="person-add-commitment"
              onClick={() => setAdding('commitment')}
            >
              <Plus className="w-4 h-4" aria-hidden /> התחייבות
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
