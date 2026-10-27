'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { WorldBadge, UnassignedHeading } from '@/components/WorldBadge'
import { FilteredWorldChip } from '@/components/WorldSwitcher'
import { splitByWorld, useWorldFilter } from '@/lib/world-filter'
import { AttentionBanner } from '@/components/relationship/AttentionBanner'
import { PRIORITY_COLORS, PRIORITY_LABELS, DAYS_HE } from '@ak-system/types'
import dynamic from 'next/dynamic'
const ConflictsWidget = dynamic(() => import('@/components/ConflictsWidget').then((m) => m.ConflictsWidget), { ssr: false })
const FeedWidget = dynamic(() => import('@/components/FeedWidget').then((m) => m.FeedWidget))
const HarnessWidget = dynamic(() => import('@/components/HarnessWidget').then((m) => m.HarnessWidget), { ssr: false })
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })
import { LS } from '@/lib/ls-keys'
import {
  sortTasksByKeys,
  migrateLegacyDashboardSort,
  TASK_SORT_KEYS,
  TASK_SORT_LABELS,
  type TaskSortKey,
  type SortPref,
} from '@/lib/sort-keys'
import { ThenBySort } from '@/components/ThenBySort'
import { groupTasksByDueState, limitTaskGroups } from '@/lib/sort-tasks'
import { formatDueLabel, isOverdueOpenTask } from '@/lib/task-due'
import { isMyTask } from '@/lib/my-tasks'

function isoDate(d: Date) {
  return d.toISOString().split('T')[0]
}

function greeting(hour: number): string {
  if (hour < 5) return 'לילה טוב'
  if (hour < 12) return 'בוקר טוב'
  if (hour < 17) return 'צהריים טובים'
  if (hour < 21) return 'ערב טוב'
  return 'לילה טוב'
}

function isPastMeeting(date: string, time: string, tz: string): boolean {
  const [h = 0, min = 0] = (time ?? '00:00').split(':').map(Number)
  const meetingStr = `${date} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  const nowStr = new Date().toLocaleString('sv-SE', { timeZone: tz }).slice(0, 16)
  return meetingStr < nowStr
}

const SVG_PLUS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const SVG_CALENDAR = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

const SVG_ARROW_LEFT = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Dashboard shows a short preview; full list lives on /tasks (progressive disclosure). */
const DASHBOARD_TASK_PREVIEW = 8

function QuickActionsBar() {
  const digestMutation = trpc.whatsapp.digest.run.useMutation()
  const [feedback, setFeedback] = useState<{ kind: 'success-groups' | 'success-empty' | 'error'; text?: string } | null>(null)
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function runDigest() {
    if (digestMutation.isPending) return
    setFeedback(null)
    digestMutation.mutate(undefined, {
      onSuccess: (res) => {
        if ((res.actionCount ?? 0) > 0) {
          setFeedback({ kind: 'success-groups' })
          feedbackTimerRef.current = setTimeout(() => setFeedback(null), 4000)
        } else {
          setFeedback({ kind: 'success-empty' })
        }
      },
      onError: (err) => {
        setFeedback({ kind: 'error', text: err.message })
      },
    })
  }

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 flex-wrap">
        <Link href="/chat?prompt=focus" className="btn btn-ghost text-sm">
          מה חשוב עכשיו?
        </Link>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={digestMutation.isPending}
          onClick={runDigest}
        >
          {digestMutation.isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              מסכם…
            </span>
          ) : (
            'סכם וואטסאפ'
          )}
        </button>
      </div>
      <div aria-live="polite" className="text-xs">
        {feedback?.kind === 'success-groups' && (
          <span className="text-[#2dd4bf]">הסיכום נשלח אליך בוואטסאפ</span>
        )}
        {feedback?.kind === 'success-empty' && (
          <span className="text-[#97a4c2]">
            עדיין אין קבוצות במעקב.{' '}
            <Link href="/settings/whatsapp" className="text-[#2dd4bf] hover:underline">
              בחר קבוצות →
            </Link>
          </span>
        )}
        {feedback?.kind === 'error' && (
          <span className="text-red-400 inline-flex items-center gap-1.5">
            הסיכום לא נשלח. בדוק שוואטסאפ מחובר בהגדרות ונסה שוב.
            <button
              type="button"
              aria-label="סגור הודעת שגיאה"
              onClick={() => setFeedback(null)}
              className="text-[#5a688c] hover:text-red-400 leading-none"
            >
              ×
            </button>
          </span>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [upcomingCount, setUpcomingCount] = useState(5)
  const [calRange, setCalRange] = useState<'today' | 'week'>('today')
  const [selectedCalIds, setSelectedCalIds] = useState<string[] | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [taskSort, setTaskSort] = useState<SortPref<TaskSortKey> | null>(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  // Load server-side sort preferences
  const { data: settingsData } = trpc.settings.listSort.get.useQuery()
  const serverDefault = settingsData?.prefs?.dashboardTasks

  useEffect(() => {
    try {
      const v = localStorage.getItem('ak:dashboard-upcoming-count')
      if (v !== null) setUpcomingCount(JSON.parse(v) || 5)
      const raw = localStorage.getItem(LS.CONFLICT_CALENDARS)
      if (raw) setSelectedCalIds(JSON.parse(raw))
      const tz = localStorage.getItem(LS.TIMEZONE)
      if (tz) setTimezone(JSON.parse(tz))
      
      // Load localStorage override or migrate legacy
      const sortRaw = localStorage.getItem(LS.DASHBOARD_TASKS_SORT)
      if (sortRaw) {
        try {
          const parsed = JSON.parse(sortRaw)
          // If it's a new SortPref object, use it
          if (parsed && typeof parsed === 'object' && 'primary' in parsed) {
            setTaskSort(parsed)
          } 
          // If it's a legacy string, migrate it
          else if (typeof parsed === 'string') {
            const migrated = migrateLegacyDashboardSort(parsed)
            if (migrated) {
              setTaskSort(migrated)
              localStorage.setItem(LS.DASHBOARD_TASKS_SORT, JSON.stringify(migrated))
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [])

  const today = isoDate(new Date())
  const weekEnd = isoDate(new Date(Date.now() + 6 * 86400000))

  const { workspaceId: worldFilter, ready: worldReady } = useWorldFilter()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery(
    { workspaceId: worldFilter ?? undefined },
    { enabled: worldReady },
  )
  const { data: tasksList = [] } = trpc.tasks.list.useQuery(
    { workspaceId: worldFilter ?? undefined },
    { enabled: worldReady },
  )
  const { data: selfPerson } = trpc.people.me.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const { data: calData } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: calRange === 'today' ? today : weekEnd },
    { staleTime: 5 * 60_000 },
  )
  const calEvents = calData?.events ?? []

  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })

  // Use server default if no local override
  const effectiveSort = taskSort ?? serverDefault ?? { primary: 'due_asc' as TaskSortKey, thenBy: 'priority_high' as TaskSortKey }
  const hasOverride = taskSort !== null

  const { matched: matchedTasks } = splitByWorld(tasksList, !!worldFilter, (t) => t.workspaceId)
  const openTasks = useMemo(() => {
    const open = matchedTasks.filter((t) => !t.done && isMyTask(t.assigneeId, selfPerson?.id))
    return sortTasksByKeys(open, effectiveSort)
  }, [matchedTasks, effectiveSort, selfPerson?.id])

  const setTaskSortAndPersist = (value: SortPref<TaskSortKey>) => {
    setTaskSort(value)
    try {
      localStorage.setItem(LS.DASHBOARD_TASKS_SORT, JSON.stringify(value))
    } catch { /* ignore */ }
  }

  const resetToDefault = () => {
    setTaskSort(null)
    try {
      localStorage.removeItem(LS.DASHBOARD_TASKS_SORT)
    } catch { /* ignore */ }
  }
  const { matched: matchedMeetings, unassigned: unassignedMeetings } = splitByWorld(meetings, !!worldFilter, (m) => m.workspaceId)
  const recurringMeetings = useMemo(() => matchedMeetings.filter((m) => m.recurring), [matchedMeetings])
  const { sortedMeetings, futureMeetings } = useMemo(() => {
    const sorted = [...matchedMeetings].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const future = sorted.filter((m) => !isPastMeeting(m.date, m.time, timezone))
    return { sortedMeetings: sorted, futureMeetings: future }
  }, [matchedMeetings, timezone])
  const pastCount = sortedMeetings.length - futureMeetings.length
  const upcomingMeetings = (showPast ? sortedMeetings : futureMeetings).slice(0, upcomingCount)

  const calMeetingCount = useMemo(() => {
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const rangeEnd =
      calRange === 'today'
        ? new Date(todayStart.getTime() + 86400000)
        : new Date(todayStart.getTime() + 7 * 86400000)

    return calEvents.filter((ev: any) => {
      if (ev.isAllDay) return false
      if (ev.status === 'cancelled') return false
      if (ev.rsvp === 'declined') return false
      const duration = new Date(ev.end).getTime() - new Date(ev.start).getTime()
      if (duration >= EIGHT_HOURS_MS) return false
      const start = new Date(ev.start)
      if (start < todayStart || start >= rangeEnd) return false
      if (selectedCalIds && selectedCalIds.length > 0) {
        return ev.calendarId != null && selectedCalIds.includes(ev.calendarId)
      }
      return true
    }).length
  }, [calEvents, calRange, selectedCalIds])

  const overdueCount = useMemo(
    () => openTasks.filter((t) => isOverdueOpenTask(t)).length,
    [openTasks],
  )
  const calendarHref = `/calendar?view=${calRange === 'today' ? 'day' : 'week'}`

  const previewGroups = useMemo(
    () => limitTaskGroups(groupTasksByDueState(openTasks), DASHBOARD_TASK_PREVIEW),
    [openTasks],
  )
  const previewCount = previewGroups.reduce((sum, group) => sum + group.tasks.length, 0)
  const moreOpenTasks = Math.max(0, openTasks.length - previewCount)

  return (
    <div className="space-y-6 md:space-y-8 min-w-0 max-w-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-[#eef3fb]">
          {greeting(new Date().getHours())}
          <span className="text-[#2dd4bf]"> 👋</span>
        </h1>
        <p className="text-sm text-[#7a89ab] mt-1">
          {new Date().toLocaleDateString('he-IL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </p>
      </header>
      <FilteredWorldChip />

      <AttentionBanner />

      <QuickActionsBar />

      {/* ── KPI Strip ───────────────────────────────────────────── */}
      <section aria-label="סיכום מהיר">
        {/* Three tiles side by side at every width; on phones they are compact
            (number + label) so the strip stays one glance instead of three tall cards. */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {/* Calendar meetings KPI. Toggles stay here; the number opens that range. */}
          <div className="card flex flex-col min-w-0 !p-3 sm:!p-5">
            <div className="flex items-start justify-between gap-1 mb-1 sm:mb-2">
              <Link href={calendarHref} className="no-underline">
                <div
                  className="text-xl sm:text-2xl font-bold tabular-nums leading-none"
                  style={{ color: '#2dd4bf' }}
                >
                  {calMeetingCount}
                </div>
              </Link>
              <div className="hidden sm:flex gap-1" role="group" aria-label="טווח זמן">
                {(['today', 'week'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setCalRange(r)}
                    aria-pressed={calRange === r}
                    className="toggle-btn"
                  >
                    {r === 'today' ? 'היום' : 'שבוע'}
                  </button>
                ))}
              </div>
            </div>
            <Link href={calendarHref} className="text-xs sm:text-sm font-semibold text-[#eef3fb] no-underline block truncate">
              אירועים ביומן
            </Link>
            <div className="hidden sm:block text-xs text-[#6f7ea0] mt-0.5">
              {calRange === 'today' ? 'היום' : '7 ימים קדימה'} · ללא כל-יום
            </div>
            {/* Phone: the range toggle sits under the label as two tiny segments */}
            <div className="flex sm:hidden gap-1 mt-2" role="group" aria-label="טווח זמן">
              {(['today', 'week'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setCalRange(r)}
                  aria-pressed={calRange === r}
                  className="toggle-btn !px-2 !py-0.5 !text-[11px]"
                >
                  {r === 'today' ? 'היום' : 'שבוע'}
                </button>
              ))}
            </div>
          </div>

          {/* Open tasks KPI. The count opens the open list; overdue is its own link. */}
          <div className="card flex flex-col min-w-0 !p-3 sm:!p-5">
            <Link href="/tasks?status=open" className="block no-underline">
              <div className="text-xl sm:text-2xl font-bold tabular-nums leading-none mb-1 sm:mb-2" style={{ color: '#fb7185' }}>
                {openTasks.length}
              </div>
              <div className="text-xs sm:text-sm font-semibold text-[#eef3fb] truncate">המשימות שלי</div>
            </Link>
            {overdueCount > 0 ? (
              <Link href="/tasks?status=overdue" className="text-[11px] sm:text-xs text-[#fb7185] sm:text-[#eef3fb] mt-1 sm:mt-0.5 inline-block no-underline hover:underline truncate">
                {overdueCount} באיחור
              </Link>
            ) : (
              <div className="text-[11px] sm:text-xs text-[#6f7ea0] mt-1 sm:mt-0.5">אין איחור</div>
            )}
          </div>

          {/* Upcoming CRM meetings KPI */}
          <Link href="/meetings" className="card card-interactive no-underline flex flex-col min-w-0 !p-3 sm:!p-5">
            <div className="text-xl sm:text-2xl font-bold tabular-nums leading-none mb-1 sm:mb-2" style={{ color: '#38bdf8' }}>
              {futureMeetings.length}
            </div>
            <div className="text-xs sm:text-sm font-semibold text-[#eef3fb] truncate">פגישות קרובות</div>
            <div className="text-[11px] sm:text-xs text-[#6f7ea0] mt-1 sm:mt-0.5 truncate">
              {recurringMeetings.length > 0 ? `כולל ${recurringMeetings.length} חוזרות` : 'ניהול פגישות'}
            </div>
          </Link>
        </div>
      </section>

      {/* ── Quick Actions ───────────────────────────────────────── */}
      <section aria-label="פעולות מהירות">
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Link
            href="/meetings?new=1"
            className="btn btn-primary flex items-center gap-2 no-underline min-h-[44px]"
          >
            {SVG_PLUS}
            פגישה חדשה
          </Link>
          <button
            type="button"
            className="btn btn-secondary flex items-center gap-2 min-h-[44px]"
            onClick={() => {
              setEditingTaskId(null)
              setTaskModalOpen(true)
            }}
          >
            {SVG_PLUS}
            משימה חדשה
          </button>
          <Link
            href="/calendar"
            className="btn btn-ghost flex items-center gap-2 no-underline min-h-[44px]"
          >
            {SVG_CALENDAR}
            יומן
          </Link>
        </div>
      </section>

      {/* ── Alerts: Calendar Conflicts ──────────────────────────── */}
      <ConflictsWidget />

      {/* ── Cross-domain insights from the harness ──────────────── */}
      <HarnessWidget />

      {/* ── Content Grid — equal cols, minmax(0) so long titles cannot widen the page ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 min-w-0 w-full max-w-full overflow-x-hidden">
        {/* Upcoming Meetings */}
        <section aria-label="פגישות קרובות" className="min-w-0 max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-4 gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
              <h2 className="text-base font-semibold text-[#eef3fb] truncate">פגישות קרובות</h2>
              {pastCount > 0 && (
                <button
                  onClick={() => setShowPast((v) => !v)}
                  aria-pressed={showPast}
                  className="toggle-btn shrink-0"
                >
                  {showPast ? 'הסתר עבר' : `עבר (${pastCount})`}
                </button>
              )}
            </div>
            <Link href="/meetings" className="section-link shrink-0">
              {SVG_ARROW_LEFT}
              הכל
            </Link>
          </div>

          {upcomingMeetings.length === 0 ? (
            <div className="card text-sm text-[#6f7ea0] py-4 px-5">
              אין פגישות קרובות
            </div>
          ) : (
            <div className="space-y-2 min-w-0 max-w-full">
              {upcomingMeetings.map((m) => {
                const past = isPastMeeting(m.date, m.time, timezone)
                return (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className={`meeting-card min-w-0 max-w-full overflow-hidden ${past ? 'opacity-55 grayscale-[20%]' : ''}`}
                  >
                    <div className={`font-semibold text-sm truncate ${past ? 'text-[#7a89ab]' : 'text-[#eef3fb]'}`}>
                      {m.title}
                    </div>
                    <WorldBadge workspaceId={m.workspaceId} />
                    <div className="text-xs text-[#8593b3] mt-1.5 truncate">
                      {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
                      {m.recurring ? ` · ${DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}` : ''}
                      {past ? ' · עבר' : ''}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
          {worldFilter && unassignedMeetings.some((m) => !isPastMeeting(m.date, m.time, timezone)) && (
            <div className="mt-4">
              <UnassignedHeading count={unassignedMeetings.filter((m) => !isPastMeeting(m.date, m.time, timezone)).length} />
              <div className="space-y-2">
                {unassignedMeetings.filter((m) => !isPastMeeting(m.date, m.time, timezone)).slice(0, 5).map((m) => (
                  <Link key={m.id} href={`/meetings/${m.id}`} className="meeting-card block">
                    <div className="font-semibold text-sm text-[#eef3fb] truncate">{m.title}</div>
                    <WorldBadge workspaceId={null} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Open Tasks — checkbox + title (+ priority dot). Details live in TaskModal. */}
        <section aria-label="המשימות שלי" className="min-w-0 max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-3 gap-2 min-w-0">
            <h2 className="text-base font-semibold text-[#eef3fb] truncate">המשימות שלי</h2>
            <Link href="/tasks" className="section-link shrink-0">
              {SVG_ARROW_LEFT}
              לרשימה
            </Link>
          </div>
          <div className="mb-3">
            <ThenBySort
              value={effectiveSort}
              onChange={setTaskSortAndPersist}
              fields={TASK_SORT_KEYS.map((k) => ({ value: k, label: TASK_SORT_LABELS[k] }))}
              showReset={hasOverride}
              onReset={resetToDefault}
            />
          </div>

          {openTasks.length === 0 ? (
            <div className="card text-sm text-[#6f7ea0] py-4 px-5">
              אין משימות שמוקצות אליך
            </div>
          ) : (
            <div className="space-y-2 min-w-0 max-w-full">
              {previewGroups.map((group) => (
                <div key={group.key}>
                  <div className="text-xs font-semibold text-[#7a89ab] mb-1">{group.label}</div>
                  {group.tasks.map((t) => {
                const priorityKey = t.priority as keyof typeof PRIORITY_COLORS
                const priorityColor = PRIORITY_COLORS[priorityKey] ?? PRIORITY_COLORS.medium
                const priorityLabel = PRIORITY_LABELS[priorityKey] ?? PRIORITY_LABELS.medium

                return (
                  <div key={t.id} className="task-row dashboard-open-task">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={t.done}
                      aria-label={`סמן "${t.title}" כבוצע`}
                      className="checkbox-btn shrink-0"
                      onClick={() => toggleTask.mutate({ id: t.id })}
                    >
                      {t.done && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      className="dashboard-open-task__title"
                      dir="auto"
                      onClick={() => {
                        setEditingTaskId(t.id)
                        setTaskModalOpen(true)
                      }}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    <WorldBadge workspaceId={t.workspaceId} />
                    {formatDueLabel(t) && (
                      <span className="text-[11px] text-[#647399] shrink-0">{formatDueLabel(t)}</span>
                    )}
                    <span
                      className="dashboard-open-task__dot"
                      style={{ background: priorityColor }}
                      title={`עדיפות ${priorityLabel}`}
                      aria-label={`עדיפות ${priorityLabel}`}
                    />
                  </div>
                )
                  })}
                </div>
              ))}
              {moreOpenTasks > 0 && (
                <Link
                  href="/tasks"
                  className="block text-center text-xs text-[#8593b3] hover:text-[#2dd4bf] py-2 transition-colors"
                >
                  עוד {moreOpenTasks} משימות בדף המשימות
                </Link>
              )}
            </div>
          )}
          {worldFilter && tasksList.some((t) => !t.workspaceId && !t.done && isMyTask(t.assigneeId, selfPerson?.id)) && (
            <div className="mt-4">
              <UnassignedHeading count={tasksList.filter((t) => !t.workspaceId && !t.done && isMyTask(t.assigneeId, selfPerson?.id)).length} />
              <div className="space-y-2">
                {tasksList.filter((t) => !t.workspaceId && !t.done && isMyTask(t.assigneeId, selfPerson?.id)).slice(0, 5).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="task-row w-full text-right"
                    onClick={() => {
                      setEditingTaskId(t.id)
                      setTaskModalOpen(true)
                    }}
                  >
                    <span className="flex-1 text-sm truncate">{t.title}</span>
                    <WorldBadge workspaceId={null} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Feed (lowest priority — progressive disclosure) ──── */}
      <FeedWidget />

      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
          void utils.tasks.list.invalidate()
        }}
        editingTaskId={editingTaskId}
        people={people}
        meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          hasNotionLink: ((w as { notionDatabases?: unknown[] }).notionDatabases?.length ?? 0) > 0,
        }))}
      />
    </div>
  )
}
