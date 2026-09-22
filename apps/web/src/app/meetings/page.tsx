'use client'

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import dynamic from 'next/dynamic'
const MeetingModal = dynamic(() => import('@/components/Modals/MeetingModal').then((m) => m.MeetingModal), { ssr: false })
import { LS } from '@/lib/ls-keys'

// New components
import { SearchInput } from './components/SearchInput'
import { QuickFilterButton } from './components/QuickFilterButton'
import { TimelineSection } from './components/TimelineSection'
import { MeetingCard, type MeetingCardData } from './components/MeetingCard'
import { AdvancedFiltersPanel } from './components/AdvancedFiltersPanel'

// Helpers
import { groupMeetingsByTime, getTodayMeetings, getThisWeekMeetings } from './lib/temporal-grouping'
import { searchMeetings } from './lib/search'

type MeetingRow = MeetingCardData

function isPastMeeting(date: string, time: string): boolean {
  const [h = 0, min = 0] = (time ?? '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, min, 0, 0)
  return dt < new Date()
}

export default function MeetingsPage() {
  // Data queries
  const { data: meetings = [], isLoading: meetingsLoading } = trpc.meetings.list.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: meetingTypes = [] } = trpc.meetingTypes.list.useQuery()
  const utils = trpc.useUtils()
  
  // Notion sync
  const { data: notionGraph } = trpc.notionGraph.configured.useQuery()
  const [notionSyncMessage, setNotionSyncMessage] = useState<string | null>(null)
  const syncNotion = trpc.notionGraph.sync.useMutation({
    onSuccess: (res) => {
      const parts = [
        `${res.meetingsUpserted ?? 0} פגישות`,
        `${res.notesUpserted ?? 0} סיכומי AI`,
      ]
      setNotionSyncMessage(
        res.errors.length > 0
          ? `סונכרנו ${parts.join(' · ')} · ${res.errors.length} שגיאות`
          : `סונכרנו ${parts.join(' · ')} מ-Notion`,
      )
      utils.meetings.list.invalidate()
    },
    onError: (err) => setNotionSyncMessage(err.message || 'סנכרון Notion נכשל'),
  })

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // ── Calendar Sync Panel ───────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; deleted: number } | null>(null)
  const [settingsCals, setSettingsCals] = useState<string[] | null>(null)
  const [panelSelected, setPanelSelected] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const userSyncRef = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS.SYNC_CALENDARS)
      const parsed: string[] | null = raw ? JSON.parse(raw) : null
      setSettingsCals(parsed)
    } catch { /* ignore */ }
  }, [])

  const today = new Date().toISOString().split('T')[0]
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: calData, isFetching: calsLoading } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: in14 },
    { enabled: panelOpen, staleTime: 60_000 }
  )
  const calEvents = calData?.events ?? []

  const allCalendars = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; source: string }>()
    for (const ev of calEvents) {
      const id = ev.calendarId ?? 'unknown'
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: ev.calendarName ?? (id.startsWith('apple:') ? 'Apple' : id),
          color: ev.calendarColor ?? '#7a89ab',
          source: id.startsWith('apple:') ? 'apple' : 'google',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.source !== b.source ? (a.source === 'google' ? -1 : 1) : a.name.localeCompare(b.name, 'he')
    )
  }, [calEvents])

  useEffect(() => {
    if (!panelOpen || allCalendars.length === 0) return
    const defaultIds = settingsCals ?? allCalendars.map((c) => c.id)
    setPanelSelected(new Set(defaultIds))
  }, [panelOpen, allCalendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!panelOpen) return
    function onOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [panelOpen])

  const purgeFreeBusy = trpc.meetings.purgeFreeBusy.useMutation({
    onSuccess: () => utils.meetings.list.invalidate(),
  })

  const deleteMeeting = trpc.meetings.delete.useMutation({
    onSuccess: () => utils.meetings.list.invalidate(),
  })

  useEffect(() => {
    purgeFreeBusy.mutate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncMutation = trpc.meetings.syncFromCalendar.useMutation({
    onSuccess: (data) => {
      utils.meetings.list.invalidate()
      utils.people.list.invalidate()
      if (userSyncRef.current) {
        setSyncResult(data)
        setSyncStatus('done')
        setPanelOpen(false)
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

  function handleSync() {
    userSyncRef.current = true
    setSyncStatus('loading')
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
    const calendarIds = panelSelected.size > 0 ? Array.from(panelSelected) : null
    syncMutation.mutate({ startDate: today, endDate: in60, calendarIds })
  }

  useEffect(() => {
    const SYNC_INTERVAL_MS = 15 * 60 * 1000
    const runSync = () => {
      const start = new Date().toISOString().split('T')[0]
      const end = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
      syncMutation.mutate({ startDate: start, endDate: end, calendarIds: null })
    }
    runSync()
    const id = setInterval(runSync, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleCal(id: string) {
    setPanelSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── New UX State ──────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'timeline' | 'past' | 'needs-date'>('timeline')
  const [searchQuery, setSearchQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState<'all' | 'today' | 'week' | 'with-tasks'>('all')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [advancedFilters, setAdvancedFilters] = useState<{
    people: string[]
    status?: 'scheduled' | 'completed' | 'cancelled'
    project?: string
  }>({ people: [] })

  // Helper maps
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const getPerson = (id: string) => peopleMap.get(id)
  const typesMap = useMemo(() => new Map(meetingTypes.map((t) => [t.id, t])), [meetingTypes])

  // Split meetings into upcoming/past/needsDate
  const { upcomingMeetings, pastMeetings, needsDateMeetings } = useMemo(() => {
    const needsDate = meetings.filter((m) => m.date === '9999-12-31')
    const withDate = meetings.filter((m) => m.date !== '9999-12-31')
    
    const upcoming = withDate
      .filter((m) => !isPastMeeting(m.date, m.time))
      .sort((a, b) => {
        const da = new Date(a.date + 'T' + (a.time || '00:00')).getTime()
        const db = new Date(b.date + 'T' + (b.time || '00:00')).getTime()
        return da - db
      })
    const past = withDate
      .filter((m) => isPastMeeting(m.date, m.time))
      .sort((a, b) => {
        const da = new Date(a.date + 'T' + (a.time || '00:00')).getTime()
        const db = new Date(b.date + 'T' + (b.time || '00:00')).getTime()
        return db - da // most recent first
      })
    return { upcomingMeetings: upcoming, pastMeetings: past, needsDateMeetings: needsDate }
  }, [meetings])

  // Apply search + filters
  const filteredUpcoming = useMemo(() => {
    let result = upcomingMeetings

    // Search
    if (searchQuery) {
      result = searchMeetings(
        result.map(m => ({
          ...m,
          people: m.peopleIds?.map(id => ({ name: getPerson(id)?.name || '' })),
          project: m.projectId ? projects.find(p => p.id === m.projectId) : null
        })),
        searchQuery
      )
    }

    // Quick filters
    if (quickFilter === 'today') {
      result = getTodayMeetings(result)
    } else if (quickFilter === 'week') {
      result = getThisWeekMeetings(result)
    } else if (quickFilter === 'with-tasks') {
      result = result.filter(m => (m.taskIds?.length ?? 0) > 0)
    }

    // Advanced filters
    if (advancedFilters.people.length > 0) {
      result = result.filter(m =>
        advancedFilters.people.some(personId => m.peopleIds?.includes(personId))
      )
    }

    if (advancedFilters.project) {
      result = result.filter(m => m.projectId === advancedFilters.project)
    }

    return result
  }, [upcomingMeetings, searchQuery, quickFilter, advancedFilters, people, projects, getPerson])

  // Temporal grouping
  const grouped = useMemo(() => groupMeetingsByTime(filteredUpcoming), [filteredUpcoming])

  const handleApplyAdvancedFilters = useCallback((filters: typeof advancedFilters) => {
    setAdvancedFilters(filters)
  }, [])

  const handleClearAdvancedFilters = useCallback(() => {
    setAdvancedFilters({ people: [] })
    setShowAdvancedFilters(false)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <Suspense fallback={null}>
        <OpenNewMeeting onOpen={() => { setEditingId(null); setModalOpen(true) }} />
      </Suspense>
      {/* Header */}
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">פגישות</h1>
        <div className="flex gap-2 items-center">
          {notionSyncMessage && (
            <span className="text-xs text-[#97a4c2] max-w-[220px] truncate" title={notionSyncMessage}>
              {notionSyncMessage}
            </span>
          )}
          {notionGraph?.configured && (
            <button
              className="btn btn-secondary"
              data-testid="sync-notion-meeting-notes"
              disabled={syncNotion.isPending}
              onClick={() => {
                setNotionSyncMessage(null)
                syncNotion.mutate({ windowDays: 7, dryRun: false, scope: 'meetings' })
              }}
              title="סנכרן סיכומי AI מדפי הפגישות ב-Notion"
            >
              {syncNotion.isPending ? 'מסנכרן Notion…' : 'סנכרן סיכומי Notion'}
            </button>
          )}
          {syncStatus === 'done' && syncResult !== null && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#34d39922', color: '#34d399', border: '1px solid #34d39944' }}>
              {syncResult.created === 0 && syncResult.updated === 0 && syncResult.deleted === 0
                ? 'הכל מעודכן ✓'
                : [
                    syncResult.created > 0 && `${syncResult.created} חדשות`,
                    syncResult.updated > 0 && `${syncResult.updated} עודכנו`,
                    syncResult.deleted > 0 && `${syncResult.deleted} הוסרו`,
                  ].filter(Boolean).join(', ') + ' ✓'}
            </span>
          )}

          {/* Calendar sync panel */}
          <div className="relative" ref={panelRef}>
            <button
              className="btn btn-ghost flex items-center gap-1.5"
              onClick={() => setPanelOpen((v) => !v)}
              disabled={syncStatus === 'loading'}
              title="סנכרן פגישות מהיומן"
            >
              {syncStatus === 'loading' ? (
                <span className="opacity-60">מסנכרן…</span>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                    <rect x="2" y="3" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M6 2v3M14 2v3M2 8h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M14 13l-2 2-2-2M12 15v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  סנכרן מיומן
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-40" style={{ transform: panelOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>

            {panelOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl"
                style={{ minWidth: 260, background: '#141f36', border: '1px solid #29395d' }}
              >
                <div className="px-4 pt-3.5 pb-2">
                  <div className="text-xs font-semibold text-[#b8c4dc] mb-0.5">יומנים לסנכרון</div>
                  <div className="text-[11px] text-[#4d659c]">
                    {settingsCals
                      ? 'ברירת המחדל לפי הגדרות — ניתן להוסיף יומנים נוספים'
                      : 'כל היומנים נבחרו — ניתן לבטל'}
                  </div>
                </div>

                <div className="px-2 pb-2 max-h-56 overflow-y-auto">
                  {calsLoading ? (
                    <div className="px-3 py-3 text-xs text-[#4d659c]">טוען יומנים…</div>
                  ) : allCalendars.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-[#4d659c]">לא נמצאו יומנים</div>
                  ) : allCalendars.map((cal) => {
                    const checked = panelSelected.has(cal.id)
                    const isDefault = settingsCals ? settingsCals.includes(cal.id) : true
                    return (
                      <button
                        key={cal.id}
                        onClick={() => toggleCal(cal.id)}
                        className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors text-right"
                      >
                        <span
                          className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-all"
                          style={{
                            background: checked ? cal.color : 'transparent',
                            border: `2px solid ${checked ? cal.color : '#3a507d'}`,
                          }}
                        >
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4L3.5 6L6.5 2" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className={`text-xs flex-1 truncate text-right ${checked ? 'text-[#b8c4dc]' : 'text-[#5a688c]'}`}>
                          {cal.name}
                        </span>
                        {isDefault && settingsCals && (
                          <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: '#2dd4bf15', color: '#2dd4bf' }}>
                            ברירת מחדל
                          </span>
                        )}
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            background: cal.source === 'google' ? '#4285f422' : '#88888822',
                            color: cal.source === 'google' ? '#4285f4' : '#7a89ab',
                          }}
                        >
                          {cal.source === 'google' ? 'Google' : 'Apple'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="border-t border-[#1e1e1e] px-3 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[#4d659c]">
                    {panelSelected.size} יומנים · 60 ימים קדימה
                  </span>
                  <button
                    className="btn btn-primary text-[12px] py-1 px-4 disabled:opacity-40"
                    onClick={handleSync}
                    disabled={panelSelected.size === 0}
                  >
                    סנכרן עכשיו
                  </button>
                </div>
              </div>
            )}
          </div>

          <button className="btn btn-primary" onClick={() => { setEditingId(null); setModalOpen(true) }}>
            + פגישה חדשה
          </button>
        </div>
      </div>

      {/* Search + Quick Filters */}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="חיפוש פגישות..."
          disabled={meetingsLoading}
          className="flex-1 max-w-xs"
        />
        <QuickFilterButton
          active={quickFilter === 'today'}
          count={getTodayMeetings(upcomingMeetings).length}
          onClick={() => setQuickFilter(quickFilter === 'today' ? 'all' : 'today')}
        >
          היום
        </QuickFilterButton>
        <QuickFilterButton
          active={quickFilter === 'week'}
          count={getThisWeekMeetings(upcomingMeetings).length}
          onClick={() => setQuickFilter(quickFilter === 'week' ? 'all' : 'week')}
        >
          השבוע
        </QuickFilterButton>
        <QuickFilterButton
          active={quickFilter === 'with-tasks'}
          onClick={() => setQuickFilter(quickFilter === 'with-tasks' ? 'all' : 'with-tasks')}
        >
          עם משימות
        </QuickFilterButton>
        <button
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          className={`btn ${showAdvancedFilters || advancedFilters.people.length > 0 || advancedFilters.project ? 'btn-primary' : 'btn-secondary'}`}
        >
          פילטרים מתקדמים {showAdvancedFilters ? '▴' : '▾'}
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <AdvancedFiltersPanel
          allPeople={people}
          allProjects={projects}
          selectedFilters={advancedFilters}
          onApply={handleApplyAdvancedFilters}
          onClear={handleClearAdvancedFilters}
        />
      )}

      {/* View Mode Toggle */}
      <div className="flex gap-2 items-center mb-6 mt-6">
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'timeline'
              ? 'bg-[#2dd4bf] text-[#0a0a0a]'
              : 'bg-[#1e2a3f] text-[#647399] hover:text-[#97a4c2]'
          }`}
          onClick={() => setViewMode('timeline')}
        >
          קרובות {filteredUpcoming.length > 0 && `(${filteredUpcoming.length})`}
        </button>
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'past'
              ? 'bg-[#2dd4bf] text-[#0a0a0a]'
              : 'bg-[#1e2a3f] text-[#647399] hover:text-[#97a4c2]'
          }`}
          onClick={() => setViewMode('past')}
        >
          עברו {pastMeetings.length > 0 && `(${pastMeetings.length})`}
        </button>
        {needsDateMeetings.length > 0 && (
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              viewMode === 'needs-date'
                ? 'bg-[#f59e0b] text-[#0a0a0a]'
                : 'bg-[#1e2a3f] text-[#f59e0b] hover:text-[#fbbf24] border border-[#f59e0b]'
            }`}
            onClick={() => setViewMode('needs-date')}
          >
            <span>⚠️</span>
            חסר תאריך ({needsDateMeetings.length})
          </button>
        )}
      </div>

      {/* Timeline View */}
      {viewMode === 'timeline' && (
        <>
          {filteredUpcoming.length === 0 && (
            <div className="text-center py-12" role="status">
              <p className="text-[#5a688c] text-sm">
                {searchQuery
                  ? 'לא נמצאו פגישות התואמות לחיפוש'
                  : quickFilter !== 'all'
                  ? 'אין פגישות בפילטר זה'
                  : 'אין פגישות קרובות'}
              </p>
            </div>
          )}

          <TimelineSection title="היום" count={grouped.today.length} defaultExpanded={true}>
            {grouped.today.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                importance="urgent"
                projects={projects}
                meetingTypes={typesMap}
                getPerson={getPerson}
                onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                onDelete={() => deleteMeeting.mutate({ id: m.id })}
              />
            ))}
          </TimelineSection>

          <TimelineSection title="מחר" count={grouped.tomorrow.length} defaultExpanded={true}>
            {grouped.tomorrow.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                importance="normal"
                projects={projects}
                meetingTypes={typesMap}
                getPerson={getPerson}
                onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                onDelete={() => deleteMeeting.mutate({ id: m.id })}
              />
            ))}
          </TimelineSection>

          <TimelineSection title="השבוע" count={grouped.thisWeek.length} defaultExpanded={grouped.thisWeek.length <= 5}>
            {grouped.thisWeek.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                importance="normal"
                projects={projects}
                meetingTypes={typesMap}
                getPerson={getPerson}
                onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                onDelete={() => deleteMeeting.mutate({ id: m.id })}
              />
            ))}
          </TimelineSection>

          <TimelineSection title="שבוע הבא" count={grouped.nextWeek.length} defaultExpanded={false}>
            {grouped.nextWeek.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                importance="normal"
                projects={projects}
                meetingTypes={typesMap}
                getPerson={getPerson}
                onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                onDelete={() => deleteMeeting.mutate({ id: m.id })}
              />
            ))}
          </TimelineSection>

          <TimelineSection title="מאוחר יותר" count={grouped.later.length} defaultExpanded={false}>
            {grouped.later.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                importance="compact"
                projects={projects}
                meetingTypes={typesMap}
                getPerson={getPerson}
                onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                onDelete={() => deleteMeeting.mutate({ id: m.id })}
              />
            ))}
          </TimelineSection>
        </>
      )}

      {/* Past View */}
      {viewMode === 'past' && (
        <>
          {pastMeetings.length === 0 ? (
            <div className="text-center py-12" role="status">
              <p className="text-[#5a688c] text-sm">אין פגישות קודמות</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pastMeetings.map((m) => (
                <MeetingCard
                  key={m.id}
                  meeting={m}
                  importance="normal"
                  past={true}
                  projects={projects}
                  meetingTypes={typesMap}
                  getPerson={getPerson}
                  onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                  onDelete={() => deleteMeeting.mutate({ id: m.id })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Needs Date View */}
      {viewMode === 'needs-date' && (
        <>
          <div className="bg-[#1e2a3f] border border-[#f59e0b] rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-[#f59e0b] font-medium mb-1">פגישות ללא תאריך</h3>
                <p className="text-[#97a4c2] text-sm">
                  הפגישות הבאות מסונכרנות מ-Notion אבל חסר להן תאריך. 
                  לחץ על כל פגישה כדי לערוך ולהוסיף תאריך.
                </p>
              </div>
            </div>
          </div>
          
          {needsDateMeetings.length === 0 ? (
            <div className="text-center py-12" role="status">
              <p className="text-[#5a688c] text-sm">אין פגישות ללא תאריך 🎉</p>
            </div>
          ) : (
            <div className="space-y-3">
              {needsDateMeetings.map((m) => (
                <div key={m.id} className="relative">
                  <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#f59e0b] rounded-full flex items-center justify-center text-xs">
                    ⚠️
                  </div>
                  <MeetingCard
                    meeting={m}
                    importance="normal"
                    projects={projects}
                    meetingTypes={typesMap}
                    getPerson={getPerson}
                    onEdit={() => { setEditingId(m.id); setModalOpen(true) }}
                    onDelete={() => deleteMeeting.mutate({ id: m.id })}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <MeetingModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingId(null) }}
        editingId={editingId}
        people={people}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  )
}

function OpenNewMeeting({ onOpen }: { onOpen: () => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const opened = useRef(false)

  useEffect(() => {
    if (opened.current || searchParams.get('new') !== '1') return
    opened.current = true
    onOpenRef.current()
    router.replace('/meetings', { scroll: false })
  }, [searchParams, router])

  return null
}
