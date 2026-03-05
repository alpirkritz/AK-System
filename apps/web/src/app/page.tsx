'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS, DAYS_HE } from '@ak-system/types'
import dynamic from 'next/dynamic'
const ConflictsWidget = dynamic(() => import('@/components/ConflictsWidget').then((m) => m.ConflictsWidget), { ssr: false })
const FeedWidget = dynamic(() => import('@/components/FeedWidget').then((m) => m.FeedWidget))
import { LS } from '@/lib/ls-keys'

function isoDate(d: Date) {
  return d.toISOString().split('T')[0]
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

const SVG_CHEVRON_LEFT = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
    <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SVG_ARROW_LEFT = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export default function DashboardPage() {
  const [upcomingCount, setUpcomingCount] = useState(5)
  const [calRange, setCalRange] = useState<'today' | 'week'>('today')
  const [selectedCalIds, setSelectedCalIds] = useState<string[] | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

  useEffect(() => {
    try {
      const v = localStorage.getItem('ak:dashboard-upcoming-count')
      if (v !== null) setUpcomingCount(JSON.parse(v) || 5)
      const raw = localStorage.getItem(LS.CONFLICT_CALENDARS)
      if (raw) setSelectedCalIds(JSON.parse(raw))
      const tz = localStorage.getItem(LS.TIMEZONE)
      if (tz) setTimezone(JSON.parse(tz))
    } catch { /* ignore */ }
  }, [])

  const today = isoDate(new Date())
  const weekEnd = isoDate(new Date(Date.now() + 6 * 86400000))

  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const { data: calEvents = [] } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: calRange === 'today' ? today : weekEnd },
    { staleTime: 5 * 60_000 },
  )

  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const getPerson = (id: string) => peopleMap.get(id)
  const openTasks = useMemo(() => tasksList.filter((t) => !t.done), [tasksList])
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

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-[#f0ede6]">דשבורד</h1>
        <p className="text-sm text-[#888] mt-1">
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
                style={{ color: '#e8c547' }}
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
            <div className="text-sm font-semibold text-[#f0ede6]">פגישות ביומן</div>
            <div className="text-xs text-[#777] mt-0.5">
              {calRange === 'today' ? 'היום' : '7 ימים קדימה'} · ללא כל-יום
            </div>
          </div>

          {/* Open tasks KPI */}
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: '#e8477a' }}>
              {openTasks.length}
            </div>
            <div className="text-sm font-semibold text-[#f0ede6] mt-2">משימות פתוחות</div>
            <div className="text-xs text-[#777] mt-0.5">ממתינות לביצוע</div>
          </div>

          {/* Recurring meetings KPI */}
          <div className="card">
            <div className="text-2xl font-bold" style={{ color: '#47b8e8' }}>
              {recurringMeetings.length}
            </div>
            <div className="text-sm font-semibold text-[#f0ede6] mt-2">חוזרות</div>
            <div className="text-xs text-[#777] mt-0.5">פגישות שבועיות</div>
          </div>
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

      {/* ── Content Grid ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-4 md:gap-6">
        {/* Upcoming Meetings */}
        <section aria-label="פגישות קרובות">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-[#f0ede6]">פגישות קרובות</h2>
              {pastCount > 0 && (
                <button
                  onClick={() => setShowPast((v) => !v)}
                  aria-pressed={showPast}
                  className="toggle-btn"
                >
                  {showPast ? 'הסתר עבר' : `כולל עבר (${pastCount})`}
                </button>
              )}
            </div>
            <Link href="/meetings" className="section-link">
              {SVG_ARROW_LEFT}
              הכל
            </Link>
          </div>

          {upcomingMeetings.length === 0 ? (
            <div className="card text-sm text-[#777] py-4 px-5">
              אין פגישות קרובות
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingMeetings.map((m) => {
                const past = isPastMeeting(m.date, m.time, timezone)
                return (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className={`meeting-card flex items-center gap-3 ${past ? 'opacity-55 grayscale-[20%]' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-semibold text-sm truncate ${past ? 'text-[#888]' : 'text-[#f0ede6]'}`}>
                          {m.title}
                        </span>
                        {past && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium"
                            style={{ background: '#ffffff12', color: '#888', border: '1px solid #3a3a3a' }}
                          >
                            עבר
                          </span>
                        )}
                        {m.recurring && (
                          <span className="pill shrink-0">
                            ↻ {DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 mt-1.5 items-center">
                        <span className="text-xs text-[#999]">
                          {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
                        </span>
                        <div className="flex gap-1">
                          {(m as { peopleIds?: string[] }).peopleIds?.map((pid) => {
                            const p = getPerson(pid)
                            return p ? (
                              <div
                                key={pid}
                                className="avatar text-[10px] border-[1.5px]"
                                style={{
                                  background: (p.color ?? '#e8c547') + '22',
                                  color: p.color ?? '#e8c547',
                                  borderColor: (p.color ?? '#e8c547') + '33',
                                }}
                              >
                                {p.name[0]}
                              </div>
                            ) : null
                          })}
                        </div>
                      </div>
                    </div>
                    {SVG_CHEVRON_LEFT}
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Open Tasks */}
        <section aria-label="משימות פתוחות">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#f0ede6]">משימות פתוחות</h2>
            <Link href="/tasks" className="section-link">
              {SVG_ARROW_LEFT}
              הכל
            </Link>
          </div>

          <div className="card py-3 px-4">
            {openTasks.length === 0 ? (
              <div className="text-[#777] text-sm py-2">
                אין משימות פתוחות
              </div>
            ) : (
              openTasks.map((t) => {
                const priorityKey = t.priority as keyof typeof PRIORITY_COLORS
                const priorityColor = PRIORITY_COLORS[priorityKey]
                const priorityLabel = PRIORITY_LABELS[priorityKey]

                return (
                  <div key={t.id} className="task-row">
                    <button
                      role="checkbox"
                      aria-checked={t.done}
                      aria-label={`סמן "${t.title}" כבוצע`}
                      className="checkbox-btn"
                      onClick={() => toggleTask.mutate({ id: t.id })}
                    >
                      {t.done && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    <span className="flex-1 text-sm text-[#f0ede6]">{t.title}</span>
                    {priorityLabel && (
                      <span
                        className="priority-badge"
                        style={{
                          color: priorityColor,
                          background: priorityColor + '18',
                        }}
                      >
                        {priorityLabel}
                      </span>
                    )}
                    {t.assigneeId && (
                      <div
                        className="avatar w-[22px] h-[22px] text-[9px] border"
                        style={{
                          background: (getPerson(t.assigneeId)?.color ?? '#e8c547') + '22',
                          color: getPerson(t.assigneeId)?.color ?? '#e8c547',
                          borderColor: (getPerson(t.assigneeId)?.color ?? '#e8c547') + '33',
                        }}
                      >
                        {getPerson(t.assigneeId)?.name[0]}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* ── Feed (lowest priority — progressive disclosure) ──── */}
      <FeedWidget />
    </div>
  )
}
