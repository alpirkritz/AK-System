'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, DAYS_HE } from '@ak-system/types'
import { ConflictsWidget } from '@/components/ConflictsWidget'
import { LS } from '@/lib/ls-keys'

function isoDate(d: Date) {
  return d.toISOString().split('T')[0]
}

function isPastMeeting(date: string, time: string): boolean {
  const [h = 0, min = 0] = (time ?? '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, min, 0, 0)
  return dt < new Date()
}

export default function DashboardPage() {
  const [upcomingCount, setUpcomingCount] = useState(5)
  const [calRange, setCalRange] = useState<'today' | 'week'>('today')
  // Calendar IDs selected in Settings → defaults to null (= all)
  const [selectedCalIds, setSelectedCalIds] = useState<string[] | null>(null)

  useEffect(() => {
    try {
      const v = localStorage.getItem('ak:dashboard-upcoming-count')
      if (v !== null) setUpcomingCount(JSON.parse(v) || 5)
      const raw = localStorage.getItem(LS.CONFLICT_CALENDARS)
      if (raw) setSelectedCalIds(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  const today = isoDate(new Date())
  const weekEnd = isoDate(new Date(Date.now() + 6 * 86400000))

  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const { data: calEvents = [] } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: calRange === 'today' ? today : weekEnd },
    { staleTime: 5 * 60_000 }
  )

  const utils = trpc.useUtils()
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  })

  const getPerson = (id: string) => people.find((p) => p.id === id)
  const openTasks = tasksList.filter((t) => !t.done)
  const recurringMeetings = meetings.filter((m) => m.recurring)
  const upcomingMeetings = [...meetings].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  ).slice(0, upcomingCount)

  // Count calendar events for the selected range — same smart filters as ConflictsWidget
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const rangeEnd = calRange === 'today'
    ? new Date(todayStart.getTime() + 86400000)
    : new Date(todayStart.getTime() + 7 * 86400000)

  const calMeetingCount = calEvents.filter((ev: any) => {
    // Exclude all-day events
    if (ev.isAllDay) return false
    // Exclude cancelled or declined events
    if (ev.status === 'cancelled') return false
    if (ev.rsvp === 'declined') return false
    // Exclude blocks >= 8 h (Focus Time, OOO, etc.)
    const duration = new Date(ev.end).getTime() - new Date(ev.start).getTime()
    if (duration >= EIGHT_HOURS_MS) return false
    // Time range
    const start = new Date(ev.start)
    if (start < todayStart || start >= rangeEnd) return false
    // Filter to calendars selected in Settings → "יומנים לבדיקה"
    if (selectedCalIds && selectedCalIds.length > 0) {
      return ev.calendarId != null && selectedCalIds.includes(ev.calendarId)
    }
    return true
  }).length

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight mb-1">שלום 👋</h1>
      <p className="text-[#555] mb-8 text-sm">
        {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Calendar meetings card with today/week toggle */}
        <div className="card">
          <div className="flex items-start justify-between mb-1">
            <div className="text-3xl font-bold" style={{ color: '#e8c547' }}>
              {calMeetingCount}
            </div>
            <div className="flex gap-1 mt-1">
              {(['today', 'week'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setCalRange(r)}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-all cursor-pointer"
                  style={{
                    background: calRange === r ? '#e8c54722' : 'transparent',
                    color:      calRange === r ? '#e8c547'   : '#444',
                    border:     `1px solid ${calRange === r ? '#e8c54744' : '#222'}`,
                  }}
                >
                  {r === 'today' ? 'היום' : 'שבוע'}
                </button>
              ))}
            </div>
          </div>
          <div className="text-sm font-semibold">פגישות ביומן</div>
          <div className="text-xs text-[#555]">{calRange === 'today' ? 'היום' : '7 ימים קדימה'} · ללא כל-יום</div>
        </div>

        {[
          { label: 'משימות פתוחות', val: openTasks.length, sub: 'ממתינות לביצוע', color: '#e8477a' },
          { label: 'חוזרות', val: recurringMeetings.length, sub: 'פגישות שבועיות', color: '#47b8e8' },
        ].map((s) => (
          <div key={s.label} className="card">
            <div className="text-3xl font-bold" style={{ color: s.color }}>
              {s.val}
            </div>
            <div className="text-sm font-semibold mt-1">{s.label}</div>
            <div className="text-xs text-[#555]">{s.sub}</div>
          </div>
        ))}
      </div>
      <ConflictsWidget />
      <div className="grid grid-cols-[1.2fr_1fr] gap-5">
        <div>
          <div className="text-xs font-semibold text-[#666] mb-3 uppercase tracking-wider">
            פגישות קרובות
          </div>
          {upcomingMeetings.map((m) => {
            const past = isPastMeeting(m.date, m.time)
            return (
              <Link key={m.id} href={`/meetings/${m.id}`}>
                <div className={`meeting-card transition-opacity ${past ? 'opacity-45 grayscale-[30%]' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-semibold text-sm truncate ${past ? 'text-[#777]' : ''}`}>{m.title}</span>
                      {past && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0 font-medium"
                          style={{ background: '#ffffff08', color: '#555', border: '1px solid #2a2a2a' }}>
                          עבר
                        </span>
                      )}
                    </div>
                    {m.recurring && (
                      <span className="pill shrink-0">↻ {DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}</span>
                    )}
                  </div>
                  <div className="flex gap-3 mt-2 items-center">
                    <span className="text-xs text-[#666]">
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
              </Link>
            )
          })}
        </div>
        <div>
          <div className="text-xs font-semibold text-[#666] mb-3 uppercase tracking-wider">
            משימות פתוחות
          </div>
          <div className="card py-3 px-4">
            {openTasks.length === 0 && (
              <div className="text-[#555] text-sm">אין משימות פתוחות 🎉</div>
            )}
            {openTasks.map((t) => (
              <div key={t.id} className="task-row">
                <div
                  className={`checkbox ${t.done ? 'checked' : ''}`}
                  onClick={() => toggleTask.mutate({ id: t.id })}
                >
                  {t.done && <span className="text-white text-[10px]">✓</span>}
                </div>
                <div className="flex-1 text-sm">{t.title}</div>
                <div className="dot" style={{ color: PRIORITY_COLORS[t.priority as keyof typeof PRIORITY_COLORS] }} />
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
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
