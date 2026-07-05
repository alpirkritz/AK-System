import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  fetchGoogleCalendarEvents,
  isGoogleCalendarConfigured,
  declineGoogleEvent,
  GoogleCalendarEvent,
  listGoogleConnections,
  hasGoogleCalendarConnections,
} from '../services/google-calendar'
import {
  fetchAppleCalendarEvents,
  isAppleCalendarAvailable,
  warmAppleCalendarCache,
  AppleCalendarEvent,
} from '../services/apple-calendar'
import { isFreeBusyPlaceholderTitle } from '../lib/calendar-filters'

let cacheWarmed = false

type CalendarEvent = GoogleCalendarEvent | AppleCalendarEvent

export interface ConflictPair {
  eventA: CalendarEvent
  eventB: CalendarEvent
  overlapStart: string
  overlapEnd: string
}

const rangeInput = z.object({
  startDate: z.string(),
  endDate: z.string(),
})

/** Merges events from all sources; dedupes by id and by title+start (Google wins over Apple). */
function mergeAndDedupe(events: CalendarEvent[]): CalendarEvent[] {
  const bySlot = new Map<string, CalendarEvent>()
  for (const ev of events) {
    const slotKey = `${ev.title}|${ev.start.slice(0, 16)}`
    const isApple = 'source' in ev && (ev as AppleCalendarEvent).source === 'apple'
    const existing = bySlot.get(slotKey)
    if (!existing) {
      bySlot.set(slotKey, ev)
    } else if (!isApple) {
      bySlot.set(slotKey, ev)
    }
  }
  const seenIds = new Set<string>()
  return [...bySlot.values()].filter((ev) => {
    if (seenIds.has(ev.id)) return false
    seenIds.add(ev.id)
    return true
  })
}

async function fetchAllEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const [googleResult, appleResult] = await Promise.allSettled([
    isGoogleCalendarConfigured()
      ? fetchGoogleCalendarEvents(start, end)
      : Promise.resolve([] as GoogleCalendarEvent[]),
    fetchAppleCalendarEvents(start, end),
  ])

  const google = googleResult.status === 'fulfilled' ? googleResult.value : []
  const apple = appleResult.status === 'fulfilled' ? appleResult.value : []

  if (appleResult.status === 'rejected') {
    console.warn('[Calendar Router] Apple fetch error:', appleResult.reason)
  }

  const all = [...google, ...apple]
  all.sort((a, b) => a.start.localeCompare(b.start))
  // סנן אירועי "פנוי" (transparency: transparent) — אלו הצגות ביומן אחר שאינן חוסמות זמן
  const filtered = all.filter((e) => (e as GoogleCalendarEvent).transparency !== 'transparent')
  return mergeAndDedupe(filtered)
}

export const calendarRouter = router({
  googleAccounts: protectedProcedure.query(async () => {
    const connections = await listGoogleConnections()
    return {
      accounts: connections.map((c) => ({
        email: c.calendarEmail,
        isActive: true,
      })),
    }
  }),

  isConnected: protectedProcedure.query(async () => {
    if (!cacheWarmed && isAppleCalendarAvailable()) {
      cacheWarmed = true
      // fire-and-forget – non-blocking; no dynamic import (static import above)
      try { warmAppleCalendarCache() } catch (_) { /* ignore */ }
    }
    const googleConnected =
      isGoogleCalendarConfigured() && (await hasGoogleCalendarConnections())
    return googleConnected || isAppleCalendarAvailable()
  }),

  events: protectedProcedure.input(rangeInput).query(async ({ input }) => {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    // extend end by 1 day so all-day events on the last day are included
    end.setDate(end.getDate() + 1)
    return fetchAllEvents(start, end)
  }),

  upcoming: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const now = new Date()
      const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      const events = await fetchAllEvents(now, end)
      return events
        .filter((e) => new Date(e.start) >= now)
        .filter((e) => !isFreeBusyPlaceholderTitle(e.title))
        .slice(0, input.limit)
    }),

  conflicts: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      calendarIds: z.array(z.string()).optional(),
    }))
    .query(async ({ input }): Promise<ConflictPair[]> => {
      const start = new Date(input.startDate)
      const end = new Date(input.endDate)
      end.setDate(end.getDate() + 1)
      let events = await fetchAllEvents(start, end)

      // filter to selected calendars if specified
      if (input.calendarIds && input.calendarIds.length > 0) {
        const ids = new Set(input.calendarIds)
        events = events.filter((e) => e.calendarId && ids.has(e.calendarId))
      }

      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000

      // exclude all-day, declined, cancelled, and day-spanning blocks
      // (e.g. Out of Office / Focus Time marked as regular events but >= 8 h long)
      events = events.filter((e) => {
        if (e.isAllDay) return false
        if (e.status === 'cancelled') return false
        if ((e as GoogleCalendarEvent).rsvp === 'declined') return false
        const duration = new Date(e.end).getTime() - new Date(e.start).getTime()
        if (duration >= EIGHT_HOURS_MS) return false
        return true
      })

      const conflicts: ConflictPair[] = []
      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const a = events[i]
          const b = events[j]
          const aStart = new Date(a.start).getTime()
          const aEnd   = new Date(a.end).getTime()
          const bStart = new Date(b.start).getTime()
          const bEnd   = new Date(b.end).getTime()
          if (aStart < bEnd && bStart < aEnd) {
            const overlapStart = new Date(Math.max(aStart, bStart)).toISOString()
            const overlapEnd   = new Date(Math.min(aEnd, bEnd)).toISOString()
            conflicts.push({ eventA: a, eventB: b, overlapStart, overlapEnd })
          }
        }
      }
      return conflicts
    }),

  declineEvent: protectedProcedure
    .input(z.object({ eventId: z.string(), calendarId: z.string() }))
    .mutation(async ({ input }) => {
      await declineGoogleEvent(input.eventId, input.calendarId)
      return { success: true }
    }),
})
