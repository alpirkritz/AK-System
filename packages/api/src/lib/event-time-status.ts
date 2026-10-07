/**
 * Where a calendar event sits relative to right now.
 *
 * Agents were told the wall clock in their system instruction yet still recited the
 * 09:00 standup at 15:51 as if it were ahead, and filed today's birthdays under
 * "already happened". Both the prefetched calendar prompt block and the calendar tool
 * payloads derive their buckets from here, so the two can never disagree.
 */

import { getDefaultTimezone } from './calendar-dates'

export type EventTimeStatus = 'past' | 'current' | 'upcoming' | 'allDay'

/** Stand-in length for an event whose end time is missing or unreadable. */
const ASSUMED_DURATION_MS = 60 * 60 * 1000

export interface TimedEvent {
  start: string
  end?: string | null
  isAllDay?: boolean
}

export function eventTimeStatus(event: TimedEvent, now = new Date()): EventTimeStatus {
  // An all-day event stays relevant for its whole day; calling it past at 15:00 would be wrong.
  if (event.isAllDay) return 'allDay'

  const startMs = Date.parse(event.start)
  // A start we cannot read must not be asserted as over. Treat it as still ahead.
  if (!Number.isFinite(startMs)) return 'upcoming'

  const parsedEnd = event.end ? Date.parse(event.end) : NaN
  // Google always sends an end, but a missing one must not leave a 09:00 event
  // reported as "happening now" all afternoon. Presume an hour and move on.
  const endMs = Number.isFinite(parsedEnd) ? parsedEnd : startMs + ASSUMED_DURATION_MS

  const nowMs = now.getTime()
  if (endMs <= nowMs) return 'past'
  return startMs <= nowMs ? 'current' : 'upcoming'
}

export interface GroupedSchedule<T> {
  summary: { inProgress: number; upcoming: number; allDay: number; past: number }
  inProgress: T[]
  upcoming: T[]
  allDay: T[]
  past: T[]
}

/**
 * Buckets rather than a flat list with labels. A status field alone was not enough —
 * agents kept copying a whole day under one "already happened" heading. Separate
 * arrays make that mistake unavailable. Nothing is dropped and order is preserved:
 * "how did my day go" still needs the morning.
 */
export function groupEventsByTime<T extends TimedEvent>(events: T[], now = new Date()): GroupedSchedule<T> {
  const buckets: GroupedSchedule<T> = {
    summary: { inProgress: 0, upcoming: 0, allDay: 0, past: 0 },
    inProgress: [],
    upcoming: [],
    allDay: [],
    past: [],
  }
  for (const event of events) {
    switch (eventTimeStatus(event, now)) {
      case 'current':
        buckets.inProgress.push(event)
        break
      case 'upcoming':
        buckets.upcoming.push(event)
        break
      case 'allDay':
        buckets.allDay.push(event)
        break
      case 'past':
        buckets.past.push(event)
        break
    }
  }
  buckets.summary = {
    inProgress: buckets.inProgress.length,
    upcoming: buckets.upcoming.length,
    allDay: buckets.allDay.length,
    past: buckets.past.length,
  }
  return buckets
}

/** The same local wall clock the agent system instruction reports. */
export function nowClockBlock(now = new Date()): { localTime: string; iso: string; timeZone: string } {
  const timeZone = getDefaultTimezone()
  return {
    localTime: now.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    iso: now.toISOString(),
    timeZone,
  }
}
