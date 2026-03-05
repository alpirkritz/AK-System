'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { trpc } from '@/lib/trpc'

import type { CalEvent, View } from './lib/types'
import { SYNC_INTERVAL_MS, HE_MONTHS } from './lib/constants'
import { startOfWeek, addDays, isoDate, fmtFullDate, fmtMonthDay } from './lib/date-utils'
import { extractCalendars } from './lib/event-utils'
import { useCalendarKeyboard } from './lib/hooks'

import CalendarHeader from './components/CalendarHeader'
import CalendarSidebar from './components/CalendarSidebar'
import WeekView from './components/WeekView'
import DayView from './components/DayView'
import MonthView from './components/MonthView'
import EventDetailPanel from './components/EventDetailPanel'
import SkeletonGrid from './components/SkeletonGrid'
import NotConnectedBanner from './components/NotConnectedBanner'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export default function CalendarPage() {
  const today = new Date()
  const isMobile = useIsMobile()
  const [view, setView] = useState<View>('week')
  const [currentDay, setCurrentDay] = useState(() => new Date(today))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [monthDate, setMonthDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  )
  // On mobile, default to day view for better usability
  const initialViewSet = useRef(false)
  useEffect(() => {
    if (!initialViewSet.current && isMobile) {
      setView('day')
      initialViewSet.current = true
    }
  }, [isMobile])

  const [selectedCalendars, setSelectedCalendars] = useState<Set<string> | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [syncResult, setSyncResult] = useState<{
    created: number
    updated: number
    deleted: number
  } | null>(null)
  const userSyncRef = useRef(false)

  // ── tRPC ──────────────────────────────────────────────────────
  const utils = trpc.useUtils()

  const syncMutation = trpc.meetings.syncFromCalendar.useMutation({
    onSuccess: (data) => {
      utils.meetings.list.invalidate()
      utils.people.list.invalidate()
      if (userSyncRef.current) {
        setSyncResult(data)
        setSyncStatus('done')
        userSyncRef.current = false
        setTimeout(() => setSyncStatus('idle'), 4000)
      }
    },
    onError: () => {
      if (userSyncRef.current) {
        userSyncRef.current = false
        setSyncStatus('idle')
      }
    },
  })

  useEffect(() => {
    const runSync = () => {
      const start = new Date().toISOString().split('T')[0]
      const end = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
      syncMutation.mutate({ startDate: start, endDate: end, calendarIds: null })
    }
    const id = setInterval(runSync, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSyncNow() {
    userSyncRef.current = true
    setSyncStatus('loading')
    const start = new Date().toISOString().split('T')[0]
    const end = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
    syncMutation.mutate({ startDate: start, endDate: end, calendarIds: null })
  }

  // ── Fetch range ───────────────────────────────────────────────
  const fetchRange = (() => {
    if (view === 'day')
      return { startDate: isoDate(currentDay), endDate: isoDate(currentDay) }
    if (view === 'week')
      return { startDate: isoDate(weekStart), endDate: isoDate(addDays(weekStart, 6)) }
    return {
      startDate: isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)),
      endDate: isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)),
    }
  })()

  const { data: isConnected, isLoading: checking } = trpc.calendar.isConnected.useQuery(
    undefined,
    { retry: false },
  )

  const { data: rawEvents = [], isLoading: loadingEvents } = trpc.calendar.events.useQuery(
    fetchRange,
    {
      enabled: isConnected === true,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  )

  // ── Calendar filter state ─────────────────────────────────────
  const calendars = extractCalendars(rawEvents as CalEvent[])

  useEffect(() => {
    if (calendars.length > 0 && selectedCalendars === null) {
      setSelectedCalendars(new Set(calendars.map((c) => c.id)))
    }
  }, [calendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCalendar = useCallback((id: string) => {
    setSelectedCalendars((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const events = selectedCalendars
    ? (rawEvents as CalEvent[]).filter((ev) =>
        selectedCalendars.has(ev.calendarId || 'unknown'),
      )
    : (rawEvents as CalEvent[])

  const isLoading = checking || (isConnected === true && loadingEvents)

  // ── Navigation ────────────────────────────────────────────────
  const prev = useCallback(() => {
    if (view === 'day') setCurrentDay((d) => addDays(d, -1))
    if (view === 'week') setWeekStart((w) => addDays(w, -7))
    if (view === 'month')
      setMonthDate((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }, [view])

  const next = useCallback(() => {
    if (view === 'day') setCurrentDay((d) => addDays(d, 1))
    if (view === 'week') setWeekStart((w) => addDays(w, 7))
    if (view === 'month')
      setMonthDate((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }, [view])

  const goToday = useCallback(() => {
    const now = new Date()
    setCurrentDay(new Date(now))
    setWeekStart(startOfWeek(now))
    setMonthDate(new Date(now.getFullYear(), now.getMonth(), 1))
  }, [])

  const handleEventClick = useCallback((ev: CalEvent) => {
    setSelectedEvent((prev) => (prev?.id === ev.id ? null : ev))
  }, [])

  const handleDayClick = useCallback((day: Date) => {
    setCurrentDay(day)
    setView('day')
  }, [])

  const handleSidebarDateSelect = useCallback(
    (day: Date) => {
      setCurrentDay(day)
      setWeekStart(startOfWeek(day))
      setMonthDate(new Date(day.getFullYear(), day.getMonth(), 1))
      if (view === 'month') setView('day')
    },
    [view],
  )

  const closePanel = useCallback(() => setSelectedEvent(null), [])

  // ── Keyboard navigation ───────────────────────────────────────
  useCalendarKeyboard({
    onToday: goToday,
    onSetView: setView,
    onPrev: prev,
    onNext: next,
    onClosePanel: closePanel,
  })

  // ── Header label ──────────────────────────────────────────────
  const headerLabel = (() => {
    if (view === 'day') return fmtFullDate(currentDay.toISOString())
    if (view === 'week')
      return `${fmtMonthDay(weekStart)} – ${fmtMonthDay(addDays(weekStart, 6))}, ${weekStart.getFullYear()}`
    return `${HE_MONTHS[monthDate.getMonth()]} ${monthDate.getFullYear()}`
  })()

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100dvh-2rem)] -m-4 md:-m-6 lg:-m-8 overflow-hidden">
      <CalendarHeader
        view={view}
        headerLabel={headerLabel}
        eventCount={events.length}
        isConnected={isConnected === true}
        isLoading={isLoading}
        syncStatus={syncStatus}
        syncResult={syncResult}
        onSetView={setView}
        onPrev={prev}
        onNext={next}
        onToday={goToday}
        onSyncNow={handleSyncNow}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main calendar area */}
        <div className="flex flex-col flex-1 relative overflow-hidden min-w-0">
          {isLoading && <SkeletonGrid />}
          {!checking && isConnected === false && <NotConnectedBanner />}
          {!isLoading && isConnected === true && view === 'day' && (
            <DayView events={events} day={currentDay} onEventClick={handleEventClick} />
          )}
          {!isLoading && isConnected === true && view === 'week' && (
            <WeekView events={events} weekStart={weekStart} onEventClick={handleEventClick} />
          )}
          {!isLoading && isConnected === true && view === 'month' && (
            <MonthView
              events={events}
              month={monthDate.getMonth()}
              year={monthDate.getFullYear()}
              onEventClick={handleEventClick}
              onDayClick={handleDayClick}
            />
          )}
          {selectedEvent && (
            <EventDetailPanel event={selectedEvent} onClose={closePanel} />
          )}
        </div>

        {/* Sidebar */}
        {isConnected === true && (
          <CalendarSidebar
            calendars={calendars}
            selected={selectedCalendars ?? new Set()}
            onToggle={toggleCalendar}
            loading={loadingEvents && calendars.length === 0}
            selectedDate={currentDay}
            onSelectDate={handleSidebarDateSelect}
          />
        )}
      </div>
    </div>
  )
}
