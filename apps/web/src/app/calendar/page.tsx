'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { trpc } from '@/lib/trpc'

type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string | null
  description?: string | null
  status?: string | null
  rsvp?: RsvpStatus
  calendarId?: string | null
  calendarName?: string | null
  calendarColor?: string | null
}

interface CalendarMeta {
  id: string
  name: string
  color: string
  source: 'google' | 'apple'
}

// ── constants ─────────────────────────────────────────────────────────────────

const HOUR_HEIGHT   = 64
const DAY_START     = 7
const DAY_END       = 22
const VISIBLE_HOURS = DAY_END - DAY_START

const HE_DAYS      = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const HE_DAYS_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const HE_MONTHS    = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר']

// ── date helpers ──────────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const day = new Date(d)
  day.setDate(day.getDate() - day.getDay())
  day.setHours(0, 0, 0, 0)
  return day
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isToday(d: Date) { return isoDate(d) === isoDate(new Date()) }

function minutesFromMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function eventTop(startIso: string): number {
  return Math.max(0, ((minutesFromMidnight(startIso) - DAY_START * 60) / 60) * HOUR_HEIGHT)
}

function eventHeight(startIso: string, endIso: string): number {
  const dur = Math.max(30, minutesFromMidnight(endIso) - minutesFromMidnight(startIso))
  return (dur / 60) * HOUR_HEIGHT
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtFullDate(iso: string) {
  const d = new Date(iso)
  return `${HE_DAYS_LONG[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function fmtMonthDay(d: Date) {
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

// ── RSVP helpers ──────────────────────────────────────────────────────────────

const RSVP_LABEL: Record<RsvpStatus, string> = {
  accepted:   'אישרתי',
  declined:   'דחיתי',
  tentative:  'אולי',
  needsAction:'ממתין לתגובה',
}

const RSVP_DOT_COLOR: Record<RsvpStatus, string> = {
  accepted:   '#4ade80',
  declined:   '#f87171',
  tentative:  '#fbbf24',
  needsAction:'#94a3b8',
}

function RsvpBadge({ rsvp, size = 'sm' }: { rsvp: RsvpStatus; size?: 'sm' | 'md' }) {
  const dot = RSVP_DOT_COLOR[rsvp]
  if (size === 'md') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium"
        style={{ background: dot + '22', color: dot, border: `1px solid ${dot}44` }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
        {RSVP_LABEL[rsvp]}
      </span>
    )
  }
  return (
    <span
      className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full z-10"
      style={{ background: dot }}
      title={RSVP_LABEL[rsvp]}
    />
  )
}

// ── color helpers ─────────────────────────────────────────────────────────────

const FALLBACK_COLORS = [
  { bg: 'rgba(59,130,246,0.18)',  border: '#60a5fa' },
  { bg: 'rgba(168,85,247,0.18)', border: '#c084fc' },
  { bg: 'rgba(16,185,129,0.18)', border: '#34d399' },
  { bg: 'rgba(245,158,11,0.18)', border: '#fbbf24' },
  { bg: 'rgba(244,63,94,0.18)',  border: '#fb7185' },
  { bg: 'rgba(6,182,212,0.18)',  border: '#22d3ee' },
]

function fallbackColor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

function eventStyle(ev: CalEvent): { bg: string; border: string } {
  if (ev.calendarColor) return { bg: ev.calendarColor + '2e', border: ev.calendarColor }
  return fallbackColor(ev.calendarId || ev.id)
}

// ── calendar metadata ─────────────────────────────────────────────────────────

function extractCalendars(events: CalEvent[]): CalendarMeta[] {
  const map = new Map<string, CalendarMeta>()
  for (const ev of events) {
    const id = ev.calendarId || 'unknown'
    if (!map.has(id)) {
      const isApple = id.startsWith('apple:')
      map.set(id, {
        id,
        name: ev.calendarName || (isApple ? 'Exchange' : id),
        color: eventStyle(ev).border,
        source: isApple ? 'apple' : 'google',
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.source !== b.source) return a.source === 'google' ? -1 : 1
    return a.name.localeCompare(b.name, 'he')
  })
}

// ── overlapping event layout ──────────────────────────────────────────────────

interface PositionedEvent { ev: CalEvent; col: number; totalCols: number }

function layoutDayEvents(events: CalEvent[]): PositionedEvent[] {
  if (events.length === 0) return []
  const sorted = [...events].sort((a, b) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
  const colEnds: number[] = []
  const assigned: { ev: CalEvent; col: number }[] = []
  for (const ev of sorted) {
    const start = new Date(ev.start).getTime()
    const end   = new Date(ev.end).getTime()
    let col = 0
    while (col < colEnds.length && colEnds[col] > start) col++
    if (col === colEnds.length) colEnds.push(end)
    else colEnds[col] = end
    assigned.push({ ev, col })
  }
  const totalCols = colEnds.length
  return assigned.map(({ ev, col }) => ({ ev, col, totalCols }))
}

// ── Calendar Sidebar ──────────────────────────────────────────────────────────

function CalendarCheckbox({ cal, checked, onToggle }: {
  cal: CalendarMeta; checked: boolean; onToggle: (id: string) => void
}) {
  return (
    <button
      onClick={() => onToggle(cal.id)}
      title={checked ? `הסתר: ${cal.name}` : `הצג: ${cal.name}`}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-right transition-colors
        hover:bg-[#111] ${checked ? 'text-[#ddd]' : 'text-[#444]'}`}
    >
      <span
        className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center transition-all"
        style={{
          background: checked ? cal.color : 'transparent',
          border: `2px solid ${checked ? cal.color : '#2e2e2e'}`,
        }}
      >
        {checked && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3.5 6L6.5 2" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
      <span className="text-xs truncate leading-tight">{cal.name}</span>
    </button>
  )
}

function CalendarSidebar({ calendars, selected, onToggle, loading }: {
  calendars: CalendarMeta[]; selected: Set<string>
  onToggle: (id: string) => void; loading: boolean
}) {
  const allSelected  = calendars.length > 0 && calendars.every((c) => selected.has(c.id))
  const noneSelected = calendars.every((c) => !selected.has(c.id))
  const toggleAll    = () => {
    if (allSelected) calendars.forEach((c) => selected.has(c.id) && onToggle(c.id))
    else             calendars.forEach((c) => !selected.has(c.id) && onToggle(c.id))
  }
  const googleCals = calendars.filter((c) => c.source === 'google')
  const appleCals  = calendars.filter((c) => c.source === 'apple')

  return (
    <div className="w-52 shrink-0 border-l border-[#1a1a1a] bg-[#070707] flex flex-col overflow-hidden">
      <div className="px-3 pt-4 pb-2 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold text-[#444] uppercase tracking-widest">יומנים</span>
        {!loading && calendars.length > 1 && (
          <button
            onClick={toggleAll}
            className="text-[10px] text-[#555] hover:text-[#aaa] transition-colors px-1.5 py-0.5 rounded hover:bg-[#111]"
          >
            {allSelected ? 'הסתר הכל' : noneSelected ? 'הצג הכל' : 'בחר הכל'}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="space-y-px">
            {[120, 80, 160, 100, 140].map((w, i) => (
              <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                <div className="w-3.5 h-3.5 rounded bg-[#1e1e1e] shrink-0 animate-pulse" />
                <div className="h-3 bg-[#1a1a1a] rounded animate-pulse" style={{ width: w }} />
              </div>
            ))}
          </div>
        )}
        {!loading && googleCals.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-[9px] text-[#444] uppercase tracking-wider font-medium">Google</span>
            </div>
            {googleCals.map((cal) => (
              <CalendarCheckbox key={cal.id} cal={cal} checked={selected.has(cal.id)} onToggle={onToggle} />
            ))}
          </div>
        )}
        {!loading && appleCals.length > 0 && (
          <div>
            {googleCals.length > 0 && <div className="mx-3 mb-2 border-t border-[#161616]" />}
            <div className="flex items-center gap-1.5 px-3 py-1.5">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#888">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <span className="text-[9px] text-[#444] uppercase tracking-wider font-medium">Exchange / Mac</span>
            </div>
            {appleCals.map((cal) => (
              <CalendarCheckbox key={cal.id} cal={cal} checked={selected.has(cal.id)} onToggle={onToggle} />
            ))}
          </div>
        )}
        {!loading && calendars.length === 0 && (
          <p className="text-[11px] text-[#333] px-3 py-3 text-center">אין יומנים</p>
        )}
      </div>
    </div>
  )
}

// ── Event Detail Panel ────────────────────────────────────────────────────────

function EventDetailPanel({ event, onClose }: { event: CalEvent | null; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!event) return null

  const s = eventStyle(event)
  const isCancelled = event.status === 'cancelled'
  const isTentativeStatus = event.status === 'tentative'
  const dateStr = fmtFullDate(event.start)
  const timeStr = event.isAllDay ? 'כל היום' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`

  const isLink = (str: string) =>
    str.startsWith('http') || str.includes('meet.google') || str.includes('zoom.us') || str.includes('teams.microsoft')

  return (
    <>
      {/* Dimmed backdrop — signals "click here to close" */}
      <div
        className="absolute inset-0 z-20 bg-black/50 cursor-pointer"
        onClick={onClose}
        title="לחץ לסגירה"
      />
      <div
        className="animate-slide-in-left absolute left-0 top-0 bottom-0 z-30 w-80 bg-[#0c0c0c] flex flex-col shadow-2xl"
        style={{ borderRight: `1px solid #1f1f1f`, borderTop: `3px solid ${s.border}` }}
      >
        <div className="flex items-start gap-3 px-4 py-4 border-b border-[#161616]">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(isCancelled || isTentativeStatus) && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium
                  ${isCancelled ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>
                  {isCancelled ? 'בוטל' : 'ממתין לאישור'}
                </span>
              )}
              {event.rsvp && event.rsvp !== 'accepted' && (
                <RsvpBadge rsvp={event.rsvp} size="md" />
              )}
            </div>
            <h2 className={`text-[15px] font-semibold leading-snug
              ${isCancelled || event.rsvp === 'declined' ? 'line-through text-[#555]' : 'text-[#eee]'}`}>
              {event.title}
            </h2>
          </div>
          {/* Close button — clear X with hover state */}
          <button
            onClick={onClose}
            aria-label="סגור"
            title="סגור (Esc)"
            className="w-7 h-7 flex items-center justify-center rounded text-[#666]
              hover:text-white hover:bg-[#222] transition-colors shrink-0 mt-0.5"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1L10 10M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="flex items-start gap-3">
            <span className="text-[16px] shrink-0 mt-0.5 opacity-80">🗓</span>
            <div>
              <div className="text-sm text-[#ccc] leading-tight">{dateStr}</div>
              <div className="text-xs text-[#666] mt-1 font-mono">{timeStr}</div>
            </div>
          </div>

          {event.rsvp && (
            <div className="flex items-center gap-3">
              <span className="text-[14px] shrink-0 opacity-70">✉️</span>
              <div>
                <RsvpBadge rsvp={event.rsvp} size="md" />
              </div>
            </div>
          )}

          {event.calendarName && (
            <div className="flex items-center gap-3">
              <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: s.border }} />
              <div>
                <span className="text-sm text-[#aaa]">{event.calendarName}</span>
                <span className="text-[10px] text-[#444] mr-1.5">
                  {(event.calendarId || '').startsWith('apple:') ? '· Exchange/Mac' : '· Google'}
                </span>
              </div>
            </div>
          )}

          {(event.location || event.description) && <div className="border-t border-[#161616]" />}

          {event.location && (
            <div className="flex items-start gap-3">
              <span className="text-[16px] shrink-0 mt-0.5 opacity-80">📍</span>
              <div className="min-w-0">
                {isLink(event.location) ? (
                  <a href={event.location} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors break-all leading-snug">
                    {event.location.includes('meet.google')      ? 'Google Meet — לחץ להצטרפות' :
                     event.location.includes('zoom.us')          ? 'Zoom — לחץ להצטרפות' :
                     event.location.includes('teams.microsoft')  ? 'Teams — לחץ להצטרפות' :
                     event.location}
                  </a>
                ) : (
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-sm text-[#aaa] hover:text-blue-400 transition-colors leading-snug">
                    {event.location}<span className="text-[#555] mr-1">↗</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {event.description && (
            <div className="flex items-start gap-3">
              <span className="text-[16px] shrink-0 mt-0.5 opacity-80">📝</span>
              <div
                className="text-sm text-[#777] leading-relaxed break-words min-w-0 [&_a]:text-blue-400 [&_a]:hover:underline"
                dangerouslySetInnerHTML={{
                  __html: event.description
                    .replace(/<script[^>]*>.*?<\/script>/gi, '')
                    .replace(/<style[^>]*>.*?<\/style>/gi, '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .replace(/\n/g, '<br/>')
                    .trim(),
                }}
              />
            </div>
          )}
        </div>

        <div className="border-t border-[#161616] px-4 py-3">
          <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-[#555]
              hover:text-[#aaa] transition-colors py-1.5 rounded hover:bg-[#111]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
            </svg>
            פתח בגוגל קלנדר
          </a>
        </div>
      </div>
    </>
  )
}

// ── Skeleton / Banner ─────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="flex-1 animate-pulse p-6 space-y-3">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-14 h-6 bg-[#1a1a1a] rounded" />
          <div className="flex-1 h-6 bg-[#161616] rounded" />
        </div>
      ))}
    </div>
  )
}

function NotConnectedBanner() {
  return (
    <div className="flex-1 flex items-start p-6">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5 w-full max-w-lg text-sm">
        <p className="font-semibold text-amber-200 mb-2">יומן גוגל לא מחובר</p>
        <p className="text-[#aaa] mb-3">
          ודא שקובץ <code className="bg-black/30 px-1 rounded">apps/web/.env.local</code> מכיל:
        </p>
        <pre className="bg-black/40 p-3 rounded text-xs overflow-x-auto text-left">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...`}
        </pre>
      </div>
    </div>
  )
}

// ── All-Day Strip ─────────────────────────────────────────────────────────────

const ALL_DAY_MAX_ROWS = 2

function AllDayStrip({ days, events, onEventClick }: {
  days: Date[]; events: CalEvent[]; onEventClick: (ev: CalEvent) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const allDayForDay = (day: Date) =>
    events.filter((ev) => ev.isAllDay && isoDate(new Date(ev.start)) === isoDate(day))

  const maxPerDay = Math.max(...days.map((d) => allDayForDay(d).length))
  if (maxPerDay === 0) return null

  const visibleRows = expanded ? maxPerDay : Math.min(maxPerDay, ALL_DAY_MAX_ROWS)

  return (
    <div className="flex border-b border-[#1a1a1a] shrink-0">
      <div className="w-14 shrink-0 flex flex-col items-end justify-between pr-2 py-1.5">
        <span className="text-[9px] text-[#3a3a3a] leading-none">כל<br/>היום</span>
        {maxPerDay > ALL_DAY_MAX_ROWS && (
          <button
            onClick={() => setExpanded((e) => !e)}
            title={expanded ? 'כווץ' : `הצג ${maxPerDay - ALL_DAY_MAX_ROWS} נוספים`}
            className="text-[9px] text-[#3a3a3a] hover:text-[#888] transition-colors leading-none"
          >
            {expanded ? '▲' : `+${maxPerDay - ALL_DAY_MAX_ROWS}`}
          </button>
        )}
      </div>
      {days.map((day, i) => {
        const dayEvents = allDayForDay(day)
        const hidden = dayEvents.length - visibleRows
        return (
          <div key={i} className="flex-1 border-l border-[#1a1a1a] first:border-l-0 px-0.5 py-1 space-y-0.5">
            {dayEvents.slice(0, visibleRows).map((ev) => {
              const s = eventStyle(ev)
              return (
                <button key={ev.id} onClick={() => onEventClick(ev)}
                  className="w-full text-right text-[10px] px-1.5 py-0.5 rounded truncate text-white/75
                    hover:brightness-125 hover:text-white transition-all cursor-pointer"
                  style={{ background: s.bg, borderLeft: `2px solid ${s.border}` }}>
                  {ev.title}
                </button>
              )
            })}
            {!expanded && hidden > 0 && (
              <button
                onClick={() => setExpanded(true)}
                title={`הצג ${hidden} אירועים נוספים`}
                className="w-full text-[9px] text-[#555] hover:text-[#aaa] px-1.5 transition-colors cursor-pointer"
              >
                +{hidden} נוספים
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Shared time-grid column ───────────────────────────────────────────────────

function DayColumn({ day, events, onEventClick }: {
  day: Date; events: CalEvent[]; onEventClick: (ev: CalEvent) => void
}) {
  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START + i)
  const positioned = layoutDayEvents(events.filter((ev) => !ev.isAllDay))

  return (
    <div className={`relative flex-1 ${isToday(day) ? 'bg-[#e8c547]/[0.018]' : ''}`}
      style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}>
      {hours.map((h) => (
        <div key={h} className="absolute inset-x-0 border-t border-[#111]"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT }} />
      ))}

      {/* Current time indicator — larger dot + brighter line for clear signaling */}
      {isToday(day) && (() => {
        const now = new Date()
        const top = ((now.getHours() * 60 + now.getMinutes() - DAY_START * 60) / 60) * HOUR_HEIGHT
        if (top < 0 || top > VISIBLE_HOURS * HOUR_HEIGHT) return null
        return (
          <div className="absolute inset-x-0 z-10 flex items-center pointer-events-none" style={{ top }}>
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 -ml-1.5 shrink-0"
              style={{ boxShadow: '0 0 6px rgba(239,68,68,0.7)' }} />
            <div className="flex-1 h-[1.5px] bg-red-500 opacity-75" />
          </div>
        )
      })()}

      {/* Event blocks */}
      {positioned.map(({ ev, col, totalCols }) => {
        const top          = eventTop(ev.start)
        const height       = eventHeight(ev.start, ev.end)
        const s            = eventStyle(ev)
        const isShort      = height < 44
        const isCancelled  = ev.status === 'cancelled'
        const isDeclined   = ev.rsvp === 'declined'
        const isTentative  = ev.rsvp === 'tentative'
        const colW  = 100 / totalCols
        const left  = `${col * colW}%`
        const width = `calc(${colW}% - 2px)`

        return (
          <button
            key={ev.id}
            onClick={() => onEventClick(ev)}
            title={`${ev.title}${ev.isAllDay ? '' : ` · ${fmtTime(ev.start)}`}`}
            className="absolute rounded overflow-hidden cursor-pointer
              transition-all hover:brightness-130 hover:z-20 hover:shadow-lg text-right
              hover:ring-1 hover:ring-white/15"
            style={{
              top,
              left,
              width,
              height: Math.max(height, 24),
              background: isTentative
                ? `repeating-linear-gradient(45deg,${s.bg},${s.bg} 4px,transparent 4px,transparent 8px)`
                : s.bg,
              borderLeft: `2px solid ${s.border}`,
              opacity: isCancelled || isDeclined ? 0.35 : 1,
              zIndex: 5,
            }}
          >
            {ev.rsvp && ev.rsvp !== 'accepted' && (
              <RsvpBadge rsvp={ev.rsvp} size="sm" />
            )}
            <div className="px-1.5 pt-0.5 overflow-hidden h-full">
              <div className={`font-medium leading-tight truncate text-white/90
                ${isShort ? 'text-[9px]' : 'text-[11px]'}
                ${(isCancelled || isDeclined) ? 'line-through' : ''}`}>
                {ev.title}
              </div>
              {!isShort && (
                <div className="text-[9px] text-white/45 font-mono truncate mt-0.5">
                  {fmtTime(ev.start)}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Time gutter ───────────────────────────────────────────────────────────────

function TimeGutter() {
  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START + i)
  return (
    <div className="w-14 shrink-0 relative" style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}>
      {hours.map((h) => (
        <div key={h}
          className="absolute right-0 text-[10px] text-[#3a3a3a] pr-2 leading-none select-none"
          style={{ top: (h - DAY_START) * HOUR_HEIGHT - 6 }}>
          {String(h).padStart(2, '0')}:00
        </div>
      ))}
    </div>
  )
}

// ── Week View ─────────────────────────────────────────────────────────────────

function WeekView({ events, weekStart, onEventClick }: {
  events: CalEvent[]; weekStart: Date; onEventClick: (ev: CalEvent) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const targetHour = now.getHours() >= DAY_START && now.getHours() < DAY_END
      ? now.getHours() - 1 : 8
    el.scrollTop = Math.max(0, (targetHour - DAY_START) * HOUR_HEIGHT - 24)
  }, [weekStart])

  const eventsForDay = (day: Date) =>
    events.filter((ev) => isoDate(new Date(ev.start)) === isoDate(day))

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[#1a1a1a] bg-[#080808] shrink-0">
        <div className="w-14 shrink-0" />
        {days.map((day, i) => (
          <div key={i} className="flex-1 text-center py-2 px-1 border-l border-[#1a1a1a] first:border-l-0">
            <div className="text-[11px] text-[#555] uppercase">{HE_DAYS[day.getDay()]}</div>
            <div className={`text-lg font-semibold mt-0.5 w-8 h-8 mx-auto flex items-center
              justify-center rounded-full
              ${isToday(day) ? 'bg-[#e8c547] text-black' : 'text-[#ccc]'}`}>
              {day.getDate()}
            </div>
          </div>
        ))}
      </div>
      <AllDayStrip days={days} events={events} onEventClick={onEventClick} />
      {/* Scroll container — fade at bottom signals more content below */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex h-full overflow-y-auto">
          <TimeGutter />
          <div className="flex flex-1 min-w-0 border-l border-[#1a1a1a]"
            style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}>
            {days.map((day, di) => (
              <div key={di} className="flex-1 border-l border-[#1a1a1a] first:border-l-0">
                <DayColumn day={day} events={eventsForDay(day)} onEventClick={onEventClick} />
              </div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#080808] to-transparent pointer-events-none" />
      </div>
    </div>
  )
}

// ── Day View ──────────────────────────────────────────────────────────────────

function DayView({ events, day, onEventClick }: {
  events: CalEvent[]; day: Date; onEventClick: (ev: CalEvent) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const targetHour = now.getHours() >= DAY_START && now.getHours() < DAY_END
      ? now.getHours() - 1 : 8
    el.scrollTop = Math.max(0, (targetHour - DAY_START) * HOUR_HEIGHT - 24)
  }, [day])

  const dayEvents = events.filter((ev) => isoDate(new Date(ev.start)) === isoDate(day))
  const timedEvents  = dayEvents.filter((ev) => !ev.isAllDay)
  const allDayEvents = dayEvents.filter((ev) => ev.isAllDay)

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[#1a1a1a] bg-[#080808] shrink-0">
        <div className="w-14 shrink-0" />
        <div className="flex-1 text-center py-3 border-l border-[#1a1a1a]">
          <div className="text-[11px] text-[#555] uppercase">{HE_DAYS[day.getDay()]}</div>
          <div className={`text-2xl font-bold mt-0.5 w-10 h-10 mx-auto flex items-center
            justify-center rounded-full
            ${isToday(day) ? 'bg-[#e8c547] text-black' : 'text-[#ccc]'}`}>
            {day.getDate()}
          </div>
          <div className="text-[11px] text-[#555] mt-0.5">
            {HE_MONTHS[day.getMonth()]} {day.getFullYear()}
          </div>
        </div>
      </div>

      {allDayEvents.length > 0 && (
        <AllDayStrip days={[day]} events={events} onEventClick={onEventClick} />
      )}

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex h-full overflow-y-auto">
          <TimeGutter />
          <div className="flex-1 border-l border-[#1a1a1a]"
            style={{ height: VISIBLE_HOURS * HOUR_HEIGHT }}>
            <DayColumn day={day} events={timedEvents} onEventClick={onEventClick} />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#080808] to-transparent pointer-events-none" />
      </div>
    </div>
  )
}

// ── Month View ────────────────────────────────────────────────────────────────

function MonthView({ events, month, year, onEventClick, onDayClick }: {
  events: CalEvent[]; month: number; year: number
  onEventClick: (ev: CalEvent) => void
  onDayClick: (day: Date) => void
}) {
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  const cells: (Date | null)[] = [
    ...Array(firstDay.getDay()).fill(null),
    ...Array.from({ length: lastDay.getDate() }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const eventsForDay = (d: Date) =>
    events.filter((ev) => isoDate(new Date(ev.start)) === isoDate(d))

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="grid grid-cols-7 border-b border-[#1a1a1a] shrink-0">
        {HE_DAYS.map((d) => (
          <div key={d} className="text-center text-[11px] text-[#555] py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {cells.map((day, i) => {
          const today     = day ? isToday(day) : false
          const dayEvents = day ? eventsForDay(day) : []
          const hasEvents = dayEvents.length > 0
          return (
            <div
              key={i}
              onClick={() => day && onDayClick(day)}
              title={day ? `${fmtFullDate(day.toISOString())} — ${hasEvents ? `${dayEvents.length} אירועים` : 'אין אירועים'}` : undefined}
              className={`min-h-[96px] border-b border-r border-[#111] p-1.5 transition-colors
                ${!day
                  ? 'bg-[#060606]'
                  : today
                    ? 'bg-[#e8c547]/[0.03] hover:bg-[#e8c547]/[0.06] cursor-pointer'
                    : 'bg-[#080808] hover:bg-[#0f0f0f] cursor-pointer'
                }
                ${i % 7 === 0 ? 'border-l-0' : ''}`}
            >
              {day && (
                <>
                  <div className={`text-sm w-7 h-7 flex items-center justify-center rounded-full mb-1
                    ${today ? 'bg-[#e8c547] text-black font-bold' : 'text-[#777]'}`}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 4).map((ev) => {
                      const s = eventStyle(ev)
                      const isDeclined = ev.rsvp === 'declined'
                      return (
                        <button
                          key={ev.id}
                          onClick={(e) => { e.stopPropagation(); onEventClick(ev) }}
                          title={ev.title}
                          className="w-full text-right text-[10px] px-1.5 py-0.5 rounded truncate
                            text-white/75 hover:brightness-125 hover:text-white/95 transition-all relative
                            cursor-pointer"
                          style={{
                            background: s.bg,
                            borderLeft: `2px solid ${s.border}`,
                            opacity: isDeclined ? 0.4 : 1,
                          }}
                        >
                          {ev.rsvp && ev.rsvp !== 'accepted' && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle shrink-0"
                              style={{ background: RSVP_DOT_COLOR[ev.rsvp] }} />
                          )}
                          {!ev.isAllDay && (
                            <span className="opacity-40 font-mono ml-1 text-[9px]">{fmtTime(ev.start)} </span>
                          )}
                          {ev.title}
                        </button>
                      )
                    })}
                    {dayEvents.length > 4 && (
                      <div className="text-[9px] text-[#555] hover:text-[#888] px-1.5 py-0.5 transition-colors cursor-pointer">
                        +{dayEvents.length - 4} נוספים
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type View = 'day' | 'week' | 'month'

export default function CalendarPage() {
  const today = new Date()
  const [view, setView]           = useState<View>('week')
  const [currentDay, setCurrentDay] = useState(() => new Date(today))
  const [weekStart, setWeekStart]   = useState(() => startOfWeek(today))
  const [monthDate, setMonthDate]   = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedCalendars, setSelectedCalendars] = useState<Set<string> | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null)

  const fetchRange = (() => {
    if (view === 'day') return { startDate: isoDate(currentDay), endDate: isoDate(currentDay) }
    if (view === 'week') return { startDate: isoDate(weekStart), endDate: isoDate(addDays(weekStart, 6)) }
    return {
      startDate: isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)),
      endDate:   isoDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)),
    }
  })()

  const { data: isConnected, isLoading: checking } =
    trpc.calendar.isConnected.useQuery(undefined, { retry: false })

  const { data: rawEvents = [], isLoading: loadingEvents } =
    trpc.calendar.events.useQuery(fetchRange, {
      enabled: isConnected === true,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    })

  const calendars = extractCalendars(rawEvents)

  useEffect(() => {
    if (calendars.length > 0 && selectedCalendars === null) {
      setSelectedCalendars(new Set(calendars.map((c) => c.id)))
    }
  }, [calendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCalendar = useCallback((id: string) => {
    setSelectedCalendars((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const events = selectedCalendars
    ? rawEvents.filter((ev) => selectedCalendars.has((ev as CalEvent).calendarId || 'unknown'))
    : rawEvents

  const isLoading = checking || (isConnected === true && loadingEvents)

  const prev = () => {
    if (view === 'day')   setCurrentDay((d) => addDays(d, -1))
    if (view === 'week')  setWeekStart((w) => addDays(w, -7))
    if (view === 'month') setMonthDate((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  }
  const next = () => {
    if (view === 'day')   setCurrentDay((d) => addDays(d, 1))
    if (view === 'week')  setWeekStart((w) => addDays(w, 7))
    if (view === 'month') setMonthDate((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
  }
  const goToday = () => {
    setCurrentDay(new Date(today))
    setWeekStart(startOfWeek(today))
    setMonthDate(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  const handleEventClick = useCallback((ev: CalEvent) => {
    setSelectedEvent((prev) => prev?.id === ev.id ? null : ev)
  }, [])

  // Clicking a month cell drills down to day view
  const handleDayClick = useCallback((day: Date) => {
    setCurrentDay(day)
    setView('day')
  }, [])

  const headerLabel = (() => {
    if (view === 'day')   return fmtFullDate(currentDay.toISOString())
    if (view === 'week')  return `${fmtMonthDay(weekStart)} – ${fmtMonthDay(addDays(weekStart, 6))}, ${weekStart.getFullYear()}`
    return `${HE_MONTHS[monthDate.getMonth()]} ${monthDate.getFullYear()}`
  })()

  const VIEW_LABELS: Record<View, string> = { day: 'יום', week: 'שבוע', month: 'חודש' }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] -m-8 overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1a1a1a] bg-[#080808] shrink-0">
        <h1 className="text-base font-bold tracking-tight">יומן</h1>

        {/* "Today" — distinct accent-on-hover signals it resets to now */}
        <button
          onClick={goToday}
          title="חזור להיום"
          className="text-xs px-3 py-1.5 rounded border border-[#2a2a2a] text-[#777]
            hover:text-[#e8c547] hover:border-[#e8c547]/50 hover:bg-[#e8c547]/5 transition-colors"
        >
          היום
        </button>

        {/* Nav arrows — ‹ goes back, › goes forward (left = earlier, right = later) */}
        <div className="flex gap-0.5">
          <button
            onClick={prev}
            aria-label="הקודם"
            title="הקודם"
            className="w-8 h-8 flex items-center justify-center rounded
              text-[#555] hover:text-[#ddd] hover:bg-[#161616] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="הבא"
            title="הבא"
            className="w-8 h-8 flex items-center justify-center rounded
              text-[#555] hover:text-[#ddd] hover:bg-[#161616] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <span className="text-sm text-[#999] font-medium select-none">{headerLabel}</span>

        {!isLoading && isConnected && (
          <span className="text-[11px] text-[#444] mr-1">{events.length} אירועים</span>
        )}
        {!isLoading && isConnected && !rawEvents.some((e) => (e as CalEvent).calendarId?.startsWith('apple:')) && (
          <span className="text-[10px] text-[#555] flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#555] animate-pulse" />
            Exchange טוען…
          </span>
        )}

        <div className="flex-1" />

        {/* RSVP legend */}
        <div className="hidden md:flex items-center gap-3 ml-2">
          {(['accepted', 'tentative', 'needsAction', 'declined'] as RsvpStatus[]).map((r) => (
            <span key={r} className="flex items-center gap-1 text-[10px] text-[#444]">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: RSVP_DOT_COLOR[r] }} />
              {RSVP_LABEL[r]}
            </span>
          ))}
        </div>

        {/* View toggle — solid active state makes current view unmistakable */}
        <div className="flex rounded-md border border-[#2a2a2a] overflow-hidden text-xs">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              title={VIEW_LABELS[v]}
              className={`px-3 py-1.5 transition-colors font-medium
                ${view === v
                  ? 'bg-[#252525] text-white'
                  : 'text-[#555] hover:text-[#ccc] hover:bg-[#141414]'
                }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex flex-col flex-1 relative overflow-hidden min-w-0">
          {isLoading && <SkeletonGrid />}
          {!checking && isConnected === false && <NotConnectedBanner />}
          {!isLoading && isConnected === true && view === 'day' && (
            <DayView events={events as CalEvent[]} day={currentDay} onEventClick={handleEventClick} />
          )}
          {!isLoading && isConnected === true && view === 'week' && (
            <WeekView events={events as CalEvent[]} weekStart={weekStart} onEventClick={handleEventClick} />
          )}
          {!isLoading && isConnected === true && view === 'month' && (
            <MonthView
              events={events as CalEvent[]}
              month={monthDate.getMonth()}
              year={monthDate.getFullYear()}
              onEventClick={handleEventClick}
              onDayClick={handleDayClick}
            />
          )}
          {selectedEvent && (
            <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
          )}
        </div>

        {isConnected === true && (
          <CalendarSidebar
            calendars={calendars}
            selected={selectedCalendars ?? new Set()}
            onToggle={toggleCalendar}
            loading={loadingEvents && calendars.length === 0}
          />
        )}
      </div>
    </div>
  )
}
