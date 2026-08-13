'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS, DAYS_HE } from '@ak-system/types'
import dynamic from 'next/dynamic'
const ConflictsWidget = dynamic(() => import('@/components/ConflictsWidget').then((m) => m.ConflictsWidget), { ssr: false })
const FeedWidget = dynamic(() => import('@/components/FeedWidget').then((m) => m.FeedWidget))
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })
import { LS } from '@/lib/ls-keys'
import {
  DASHBOARD_TASK_SORT_OPTIONS,
  DEFAULT_DASHBOARD_TASK_SORT,
  isDashboardTaskSort,
  sortDashboardTasks,
  type DashboardTaskSort,
} from '@/lib/sort-tasks'

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

export default function DashboardPage() {
  const [upcomingCount, setUpcomingCount] = useState(5)
  const [calRange, setCalRange] = useState<'today' | 'week'>('today')
  const [selectedCalIds, setSelectedCalIds] = useState<string[] | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [taskSort, setTaskSort] = useState<DashboardTaskSort>(DEFAULT_DASHBOARD_TASK_SORT)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem('ak:dashboard-upcoming-count')
      if (v !== null) setUpcomingCount(JSON.parse(v) || 5)
      const raw = localStorage.getItem(LS.CONFLICT_CALENDARS)
      if (raw) setSelectedCalIds(JSON.parse(raw))
      const tz = localStorage.getItem(LS.TIMEZONE)
      if (tz) setTimezone(JSON.parse(tz))
      const sortRaw = localStorage.getItem(LS.DASHBOARD_TASKS_SORT)
      if (sortRaw) {
        const parsed = JSON.parse(sortRaw)
        if (isDashboardTaskSort(parsed)) setTaskSort(parsed)
      }
    } catch { /* ignore */ }
  }, [])

  const today = isoDate(new Date())
  const weekEnd = isoDate(new Date(Date.now() + 6 * 86400000))

  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
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

  const openTasks = useMemo(() => {
    const open = tasksList.filter((t) => !t.done)
    return sortDashboardTasks(open, taskSort)
  }, [tasksList, taskSort])

  const setTaskSortAndPersist = (value: DashboardTaskSort) => {
    setTaskSort(value)
    try {
      localStorage.setItem(LS.DASHBOARD_TASKS_SORT, JSON.stringify(value))
    } catch { /* ignore */ }
  }
  const recurringMeetings = useMemo(() => meetings.filter((m) => m.recurring), [meetings])
  const { sortedMeetings, futureMeetings } = useMemo(() => {
    const sorted = [...meetings].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const future = sorted.filter((m) => !isPastMeeting(m.date, m.time, timezone))
    return { sortedMeetings: sorted, futureMeetings: future }
  }, [meetings, timezone])
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

  const previewTasks = openTasks.slice(0, DASHBOARD_TASK_PREVIEW)
  const moreOpenTasks = Math.max(0, openTasks.length - previewTasks.length)

  return (
    <div className="space-y-8 min-w-0 max-w-full">
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

      {/* ── KPI Strip (static — NOT clickable) ──────────────────── */}
      <section aria-label="סיכום מהיר">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {/* Calendar meetings KPI */}
          <div className="card">
            <div className="flex items-start justify-between mb-2">
              <div
                className="text-2xl font-bold"
                style={{ color: '#2dd4bf' }}
              >
                {calMeetingCount}
              </div>
              <div className="flex gap-1" role="group" aria-label="טווח זמן">
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
            <div className="text-sm font-semibold text-[#eef3fb]">אירועים ביומן</div>
            <div className="text-xs text-[#6f7ea0] mt-0.5">
              {calRange === 'today' ? 'היום' : '7 ימים קדימה'} · ללא כל-יום
            </div>
          </div>

          {/* Open tasks KPI */}
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: '#fb7185' }}>
              {openTasks.length}
            </div>
            <div className="text-sm font-semibold text-[#eef3fb] mt-2">משימות פתוחות</div>
            <div className="text-xs text-[#6f7ea0] mt-0.5">ממתינות לביצוע</div>
          </div>

          {/* Upcoming CRM meetings KPI */}
          <Link href="/meetings" className="card card-interactive no-underline block">
            <div className="text-2xl font-bold" style={{ color: '#38bdf8' }}>
              {futureMeetings.length}
            </div>
            <div className="text-sm font-semibold text-[#eef3fb] mt-2">פגישות קרובות</div>
            <div className="text-xs text-[#6f7ea0] mt-0.5">
              {recurringMeetings.length > 0 ? `כולל ${recurringMeetings.length} חוזרות` : 'ניהול פגישות'}
            </div>
          </Link>
        </div>
      </section>

      {/* ── Quick Actions ───────────────────────────────────────── */}
      <section aria-label="פעולות מהירות">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/meetings"
            className="btn btn-primary flex items-center gap-2 no-underline min-h-[40px]"
          >
            {SVG_PLUS}
            פגישה חדשה
          </Link>
          <Link
            href="/tasks"
            className="btn btn-secondary flex items-center gap-2 no-underline min-h-[40px]"
          >
            {SVG_PLUS}
            משימה חדשה
          </Link>
          <Link
            href="/calendar"
            className="btn btn-ghost flex items-center gap-2 no-underline min-h-[40px]"
          >
            {SVG_CALENDAR}
            יומן
          </Link>
        </div>
      </section>

      {/* ── Alerts: Calendar Conflicts ──────────────────────────── */}
      <ConflictsWidget />

      {/* ── Content Grid — equal cols, minmax(0) so long titles cannot widen the page ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 min-w-0 w-full max-w-full overflow-x-hidden">
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
        </section>

        {/* Open Tasks — checkbox + title (+ priority dot). Details live in TaskModal. */}
        <section aria-label="משימות פתוחות" className="min-w-0 max-w-full overflow-hidden">
          <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
            <h2 className="text-base font-semibold text-[#eef3fb] truncate">משימות פתוחות</h2>
            <Link href="/tasks" className="section-link shrink-0">
              {SVG_ARROW_LEFT}
              הכל
            </Link>
          </div>
          <label className="block mb-3 min-w-0">
            <span className="sr-only">מיון משימות</span>
            <select
              className="select w-full text-xs py-1.5 px-2 max-w-full"
              aria-label="מיון משימות"
              value={taskSort}
              onChange={(e) => setTaskSortAndPersist(e.target.value as DashboardTaskSort)}
            >
              {DASHBOARD_TASK_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {openTasks.length === 0 ? (
            <div className="card text-sm text-[#6f7ea0] py-4 px-5">
              אין משימות פתוחות
            </div>
          ) : (
            <div className="space-y-2 min-w-0 max-w-full">
              {previewTasks.map((t) => {
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
                      onClick={() => {
                        setEditingTaskId(t.id)
                        setTaskModalOpen(true)
                      }}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    <span
                      className="dashboard-open-task__dot"
                      style={{ background: priorityColor }}
                      title={`עדיפות ${priorityLabel}`}
                      aria-label={`עדיפות ${priorityLabel}`}
                    />
                  </div>
                )
              })}
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
