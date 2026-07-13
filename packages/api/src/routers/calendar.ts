import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { localDateRangeToUtc } from '../lib/calendar-dates'
import {
  fetchGoogleCalendarEvents,
  isGoogleCalendarConfigured,
  declineGoogleEvent,
  GoogleCalendarEvent,
  GoogleCalendarFetchError,
  listGoogleConnections,
  hasGoogleCalendarConnections,
  listAllGoogleCalendars,
} from '../services/google-calendar'
import { probeGoogleCalendarHealth } from '../services/google-calendar-health'
import {
  fetchAppleCalendarEvents,
  isAppleCalendarAvailable,
  warmAppleCalendarCache,
  AppleCalendarEvent,
} from '../services/apple-calendar'
import { isFreeBusyPlaceholderTitle } from '../lib/calendar-filters'

let cacheWarmed = false

type CalendarEvent = GoogleCalendarEvent | AppleCalendarEvent

export type CalendarEventsResult = {
  events: CalendarEvent[]
  googleErrors: GoogleCalendarFetchError[]
}

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

async function fetchAllEvents(startDate: string, endDate: string): Promise<CalendarEventsResult> {
  const { timeMin, timeMax } = localDateRangeToUtc(startDate, endDate)
  const googleErrors: GoogleCalendarFetchError[] = []

  const [googleResult, appleResult] = await Promise.allSettled([
    isGoogleCalendarConfigured()
      ? fetchGoogleCalendarEvents(timeMin, timeMax)
      : Promise.resolve({ events: [] as GoogleCalendarEvent[], errors: [] }),
    fetchAppleCalendarEvents(timeMin, timeMax),
  ])

  let google: GoogleCalendarEvent[] = []
  if (googleResult.status === 'fulfilled') {
    google = googleResult.value.events
    googleErrors.push(...googleResult.value.errors)
  } else {
    console.warn('[Calendar Router] Google fetch error:', googleResult.reason)
    googleErrors.push({
      email: 'google',
      message:
        googleResult.reason instanceof Error
          ? googleResult.reason.message
          : 'Google Calendar fetch failed',
    })
  }

  const apple = appleResult.status === 'fulfilled' ? appleResult.value : []

  if (appleResult.status === 'rejected') {
    console.warn('[Calendar Router] Apple fetch error:', appleResult.reason)
  }

  const all = [...google, ...apple]
  all.sort((a, b) => a.start.localeCompare(b.start))
  const filtered = all.filter((e) => (e as GoogleCalendarEvent).transparency !== 'transparent')
  return { events: mergeAndDedupe(filtered), googleErrors }
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

  googleHealth: protectedProcedure.query(async () => {
    const accounts = await probeGoogleCalendarHealth()
    return { accounts }
  }),

  isConnected: protectedProcedure.query(async () => {
    if (!cacheWarmed && isAppleCalendarAvailable()) {
      cacheWarmed = true
      try { warmAppleCalendarCache() } catch (_) { /* ignore */ }
    }
    const googleConnected =
      isGoogleCalendarConfigured() && (await hasGoogleCalendarConnections())
    return googleConnected || isAppleCalendarAvailable()
  }),

  events: protectedProcedure.input(rangeInput).query(async ({ input }) => {
    return fetchAllEvents(input.startDate, input.endDate)
  }),

  upcoming: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const now = new Date()
      const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      const endDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.TIMEZONE || 'Asia/Jerusalem',
      }).format(end)
      const startDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.TIMEZONE || 'Asia/Jerusalem',
      }).format(now)
      const { events, googleErrors } = await fetchAllEvents(startDate, endDate)
      const filtered = events
        .filter((e) => new Date(e.start) >= now)
        .filter((e) => !isFreeBusyPlaceholderTitle(e.title))
        .slice(0, input.limit)
      return { events: filtered, googleErrors }
    }),

  catalog: protectedProcedure.query(async () => {
    const googleCals = await listAllGoogleCalendars()

    const appleMap = new Map<string, { id: string; name: string; color: string; source: 'apple' }>()
    if (isAppleCalendarAvailable()) {
      const now = new Date()
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      const appleEvents = await fetchAppleCalendarEvents(start, end)
      for (const ev of appleEvents) {
        const id = ev.calendarId || 'apple:unknown'
        if (!appleMap.has(id)) {
          appleMap.set(id, {
            id,
            name: ev.calendarName || id,
            color: ev.calendarColor || '#888888',
            source: 'apple',
          })
        }
      }
    }

    const calendars = [
      ...googleCals,
      ...Array.from(appleMap.values()),
    ].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'google' ? -1 : 1
      return a.name.localeCompare(b.name, 'he')
    })

    return { calendars }
  }),

  conflicts: protectedProcedure
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
      calendarIds: z.array(z.string()).optional(),
    }))
    .query(async ({ input }): Promise<ConflictPair[]> => {
      let { events } = await fetchAllEvents(input.startDate, input.endDate)

      if (input.calendarIds && input.calendarIds.length > 0) {
        const ids = new Set(input.calendarIds)
        events = events.filter((e) => e.calendarId && ids.has(e.calendarId))
      }

      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000

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
