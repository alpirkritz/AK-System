import type { CalEvent, CalendarMeta, PositionedEvent } from './types'
import { FALLBACK_COLORS } from './constants'

function fallbackColor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

export function eventStyle(ev: CalEvent): { bg: string; border: string } {
  if (ev.calendarColor) return { bg: ev.calendarColor + '2e', border: ev.calendarColor }
  return fallbackColor(ev.calendarId || ev.id)
}

export function eventHoverBg(ev: CalEvent): string {
  if (ev.calendarColor) return ev.calendarColor + '40'
  const fb = fallbackColor(ev.calendarId || ev.id)
  return fb.bg.replace('0.18', '0.30')
}

export function extractCalendars(events: CalEvent[]): CalendarMeta[] {
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

export function layoutDayEvents(events: CalEvent[]): PositionedEvent[] {
  if (events.length === 0) return []
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )
  const colEnds: number[] = []
  const assigned: { ev: CalEvent; col: number }[] = []
  for (const ev of sorted) {
    const start = new Date(ev.start).getTime()
    const end = new Date(ev.end).getTime()
    let col = 0
    while (col < colEnds.length && colEnds[col] > start) col++
    if (col === colEnds.length) colEnds.push(end)
    else colEnds[col] = end
    assigned.push({ ev, col })
  }
  const totalCols = colEnds.length
  return assigned.map(({ ev, col }) => ({ ev, col, totalCols }))
}
