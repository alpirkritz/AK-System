'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { DAYS_HE } from '@ak-system/types'
import dynamic from 'next/dynamic'
const MeetingModal = dynamic(() => import('@/components/Modals/MeetingModal').then((m) => m.MeetingModal), { ssr: false })
import { LS } from '@/lib/ls-keys'

type MeetingRow = {
  id: string
  title: string
  date: string
  time: string
  recurring: string | null
  recurrenceDay: string | null
  projectId?: string | null
  calendarEventId?: string | null
  calendarSource?: string | null
  peopleIds?: string[]
  taskIds?: string[]
}

const SOURCE_LABEL: Record<string, string> = { google: 'Google', apple: 'Apple' }
const SOURCE_COLOR: Record<string, string> = { google: '#4285f4', apple: '#888' }

function isPastMeeting(date: string, time: string): boolean {
  const [h = 0, min = 0] = (time ?? '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, min, 0, 0)
  return dt < new Date()
}

export default function MeetingsPage() {
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const utils = trpc.useUtils()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // ── Sync panel state ──────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [syncResult, setSyncResult] = useState<{ created: number; updated: number; deleted: number } | null>(null)
  // default calendar IDs from settings (null = all)
  const [settingsCals, setSettingsCals] = useState<string[] | null>(null)
  // selection inside the panel (may include extra calendars)
  const [panelSelected, setPanelSelected] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const userSyncRef = useRef(false)

  // Load settings-configured calendars from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS.SYNC_CALENDARS)
      const parsed: string[] | null = raw ? JSON.parse(raw) : null
      setSettingsCals(parsed)
    } catch { /* ignore */ }
  }, [])

  // Fetch all available calendars (next 14 days is enough to discover them)
  const today = new Date().toISOString().split('T')[0]
  const in14  = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
  const { data: calEvents = [], isFetching: calsLoading } = trpc.calendar.events.useQuery(
    { startDate: today, endDate: in14 },
    { enabled: panelOpen, staleTime: 60_000 }
  )

  // Derive unique calendars from events
  const allCalendars = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string; source: string }>()
    for (const ev of calEvents) {
      const id = ev.calendarId ?? 'unknown'
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: ev.calendarName ?? (id.startsWith('apple:') ? 'Apple' : id),
          color: ev.calendarColor ?? '#888',
          source: id.startsWith('apple:') ? 'apple' : 'google',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.source !== b.source ? (a.source === 'google' ? -1 : 1) : a.name.localeCompare(b.name, 'he')
    )
  }, [calEvents])

  // When panel opens, initialise selection: settings calendars + default-check all if none configured
  useEffect(() => {
    if (!panelOpen) return
    if (allCalendars.length === 0) return
    const defaultIds = settingsCals ?? allCalendars.map((c) => c.id)
    setPanelSelected(new Set(defaultIds))
  }, [panelOpen, allCalendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close panel on outside click
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

  // Run once on mount to clean up old free/busy placeholder meetings
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

  // Sync from calendar every 15 minutes (full sync: updates, deletes, inserts)
  useEffect(() => {
    const SYNC_INTERVAL_MS = 15 * 60 * 1000
    const runSync = () => {
      const start = new Date().toISOString().split('T')[0]
      const end = new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0]
      syncMutation.mutate({ startDate: start, endDate: end, calendarIds: null })
    }
    const id = setInterval(runSync, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, []) // eslint-disable-next-line react-hooks/exhaustive-deps

  function toggleCal(id: string) {
    setPanelSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const [pastExpanded, setPastExpanded] = useState(false)

  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])
  const getPerson = (id: string) => peopleMap.get(id)
  const meetingsWithIds = meetings as MeetingRow[]

  const { upcomingMeetings, pastMeetings } = useMemo(() => {
    const upcoming = meetingsWithIds
      .filter((m) => !isPastMeeting(m.date, m.time))
      .sort((a, b) => {
        const da = new Date(a.date + 'T' + (a.time || '00:00')).getTime()
        const db = new Date(b.date + 'T' + (b.time || '00:00')).getTime()
        return da - db
      })
    const past = meetingsWithIds
      .filter((m) => isPastMeeting(m.date, m.time))
      .sort((a, b) => {
        const da = new Date(a.date + 'T' + (a.time || '00:00')).getTime()
        const db = new Date(b.date + 'T' + (b.time || '00:00')).getTime()
        return db - da // most recent past first
      })
    return { upcomingMeetings: upcoming, pastMeetings: past }
  }, [meetingsWithIds])

  const renderMeetingCard = useCallback((m: MeetingRow, past = false) => {
    const proj = m.projectId ? projects.find((p) => p.id === m.projectId) : null
    return (
      <div key={m.id} className={`group relative ${past ? 'opacity-50' : ''}`}>
        <Link href={`/meetings/${m.id}`} className="block">
          <div className="meeting-card py-4 px-5">
            <div className="flex justify-between items-center">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`font-semibold text-[15px] ${past ? 'text-[#777]' : ''}`}>{m.title}</span>
                  {past && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                      style={{ background: '#ffffff08', color: '#555', border: '1px solid #2a2a2a' }}>
                      עבר
                    </span>
                  )}
                  {proj && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: '#e8c54722', color: '#e8c547', border: '1px solid #e8c54733' }}
                    >
                      📁 {proj.name}
                    </span>
                  )}
                  {m.calendarSource && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: (SOURCE_COLOR[m.calendarSource] ?? '#888') + '22',
                        color: SOURCE_COLOR[m.calendarSource] ?? '#888',
                        border: `1px solid ${(SOURCE_COLOR[m.calendarSource] ?? '#888')}33`,
                      }}
                    >
                      {SOURCE_LABEL[m.calendarSource] ?? m.calendarSource}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  <span className="text-xs text-[#666]">
                    📅 {new Date(m.date + 'T00:00:00').toLocaleDateString('he-IL')} · {m.time}
                  </span>
                  {m.recurring && (
                    <span className="pill">↻ {DAYS_HE[m.recurrenceDay ?? ''] ?? 'שבועי'}</span>
                  )}
                  <span className="text-xs text-[#666]">◻ {(m.taskIds ?? []).length} משימות</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0 mr-3">
                {(m.peopleIds ?? []).map((pid) => {
                  const p = getPerson(pid)
                  return p ? (
                    <div
                      key={pid}
                      className="avatar border-[1.5px]"
                      style={{ background: (p.color ?? '#e8c547') + '22', color: p.color ?? '#e8c547', borderColor: (p.color ?? '#e8c547') + '33' }}
                    >
                      {p.name[0]}
                    </div>
                  ) : null
                })}
              </div>
            </div>
          </div>
        </Link>
        <div className="absolute top-1/2 -translate-y-1/2 left-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.preventDefault(); setEditingId(m.id); setModalOpen(true) }}
            className="text-[#666] hover:text-[#ccc] transition-colors p-1.5 rounded-lg hover:bg-[#1e1e1e]"
            title="ערוך"
          >
            ✏
          </button>
          <button
            onClick={(e) => {
              e.preventDefault()
              if (window.confirm('למחוק את הפגישה?')) deleteMeeting.mutate({ id: m.id })
            }}
            className="p-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors"
            style={{ color: '#666' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#e57373')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
            title="מחק"
          >
            🗑
          </button>
        </div>
      </div>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, people, deleteMeeting])

  return (
    <div>
      <div className="flex justify-between items-center mb-7">
        <h1 className="text-2xl font-bold tracking-tight">פגישות</h1>
        <div className="flex gap-2 items-center">
          {/* Sync result feedback */}
          {syncStatus === 'done' && syncResult !== null && (
            <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#47b86e22', color: '#47b86e', border: '1px solid #47b86e44' }}>
              {syncResult.created === 0 && syncResult.updated === 0 && syncResult.deleted === 0
                ? 'הכל מעודכן ✓'
                : [
                    syncResult.created > 0 && `${syncResult.created} חדשות`,
                    syncResult.updated > 0 && `${syncResult.updated} עודכנו`,
                    syncResult.deleted > 0 && `${syncResult.deleted} הוסרו`,
                  ].filter(Boolean).join(', ') + ' ✓'}
            </span>
          )}

          {/* Sync button + panel wrapper */}
          <div className="relative" ref={panelRef}>
            {/* Sync button — signifier: calendar icon communicates origin; affordance: standard btn */}
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
                  {/* Chevron — signifier: panel can be opened */}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-40" style={{ transform: panelOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>

            {/* Calendar selection panel */}
            {panelOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl"
                style={{ minWidth: 260, background: '#141414', border: '1px solid #222' }}
              >
                <div className="px-4 pt-3.5 pb-2">
                  <div className="text-xs font-semibold text-[#ccc] mb-0.5">יומנים לסנכרון</div>
                  <div className="text-[11px] text-[#444]">
                    {settingsCals
                      ? 'ברירת המחדל לפי הגדרות — ניתן להוסיף יומנים נוספים'
                      : 'כל היומנים נבחרו — ניתן לבטל'}
                  </div>
                </div>

                {/* Calendar list */}
                <div className="px-2 pb-2 max-h-56 overflow-y-auto">
                  {calsLoading ? (
                    <div className="px-3 py-3 text-xs text-[#444]">טוען יומנים…</div>
                  ) : allCalendars.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-[#444]">לא נמצאו יומנים</div>
                  ) : allCalendars.map((cal) => {
                    const checked = panelSelected.has(cal.id)
                    const isDefault = settingsCals ? settingsCals.includes(cal.id) : true
                    return (
                      <button
                        key={cal.id}
                        onClick={() => toggleCal(cal.id)}
                        className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg hover:bg-[#1e1e1e] transition-colors text-right"
                      >
                        {/* Checkbox — affordance: clearly toggleable */}
                        <span
                          className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-all"
                          style={{
                            background: checked ? cal.color : 'transparent',
                            border: `2px solid ${checked ? cal.color : '#333'}`,
                          }}
                        >
                          {checked && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4L3.5 6L6.5 2" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className={`text-xs flex-1 truncate text-right ${checked ? 'text-[#ccc]' : 'text-[#555]'}`}>
                          {cal.name}
                        </span>
                        {/* Signifier: default-from-settings badge */}
                        {isDefault && settingsCals && (
                          <span className="text-[9px] px-1 py-0.5 rounded shrink-0" style={{ background: '#e8c54715', color: '#e8c547' }}>
                            ברירת מחדל
                          </span>
                        )}
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            background: cal.source === 'google' ? '#4285f422' : '#88888822',
                            color: cal.source === 'google' ? '#4285f4' : '#888',
                          }}
                        >
                          {cal.source === 'google' ? 'Google' : 'Apple'}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Divider + action row */}
                <div className="border-t border-[#1e1e1e] px-3 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[#444]">
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

      {/* Upcoming meetings */}
      {upcomingMeetings.length === 0 && pastMeetings.length === 0 && (
        <p className="text-[#555] text-sm mt-4">אין פגישות עדיין</p>
      )}
      {upcomingMeetings.length === 0 && pastMeetings.length > 0 && (
        <p className="text-[#555] text-sm mt-4 mb-4">אין פגישות קרובות</p>
      )}
      {upcomingMeetings.map((m) => renderMeetingCard(m, false))}

      {/* Past meetings — collapsible section */}
      {pastMeetings.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setPastExpanded((v) => !v)}
            className="flex items-center gap-2 mb-3 group/past cursor-pointer"
          >
            <span className="text-xs font-semibold text-[#444] uppercase tracking-wider group-hover/past:text-[#666] transition-colors">
              עברו · {pastMeetings.length}
            </span>
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              className="text-[#444] group-hover/past:text-[#666] transition-all"
              style={{ transform: pastExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            >
              <path d="M2 4.5l4 3 4-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {pastExpanded && (
            <div>
              {pastMeetings.map((m) => renderMeetingCard(m, true))}
            </div>
          )}
        </div>
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
