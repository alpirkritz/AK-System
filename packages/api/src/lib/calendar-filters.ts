/** Exact-match Hebrew titles from Google cross-calendar visibility */
export const FREE_BUSY_PLACEHOLDER_TITLES_HE = ['פנוי', 'לא פנוי'] as const

/** English titles — matched case-insensitively via isFreeBusyPlaceholderTitle */
export const FREE_BUSY_PLACEHOLDER_TITLES_EN = ['free', 'busy', 'tentative'] as const

/** All stored title variants for SQL inArray purge (covers historical casing in DB) */
export const FREE_BUSY_PLACEHOLDER_TITLES_FOR_DB: string[] = [
  ...FREE_BUSY_PLACEHOLDER_TITLES_HE,
  ...FREE_BUSY_PLACEHOLDER_TITLES_EN,
  ...FREE_BUSY_PLACEHOLDER_TITLES_EN.map(
    (w) => w.charAt(0).toUpperCase() + w.slice(1),
  ),
  ...FREE_BUSY_PLACEHOLDER_TITLES_EN.map((w) => w.toUpperCase()),
]

export function isFreeBusyPlaceholderTitle(title: string): boolean {
  const t = title.trim()
  if ((FREE_BUSY_PLACEHOLDER_TITLES_HE as readonly string[]).includes(t)) return true
  return (FREE_BUSY_PLACEHOLDER_TITLES_EN as readonly string[]).includes(t.toLowerCase())
}

/** Timed-meeting alerts (pre-meeting, calendar optimizer) ignore all-day + ≥8h blocks. */
export const TIMED_MEETING_ALERT_MAX_EVENT_MS = 8 * 60 * 60 * 1000

/** @deprecated Use TIMED_MEETING_ALERT_MAX_EVENT_MS */
export const CALENDAR_OPTIMIZER_MAX_EVENT_MS = TIMED_MEETING_ALERT_MAX_EVENT_MS

export function isExcludedFromTimedMeetingAlerts(event: {
  start: string
  end: string
  isAllDay?: boolean
}): boolean {
  if (event.isAllDay) return true
  if (!event.start.includes('T')) return true
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime()
  return durationMs >= TIMED_MEETING_ALERT_MAX_EVENT_MS
}

/** @deprecated Use isExcludedFromTimedMeetingAlerts */
export const isExcludedFromCalendarOptimizer = isExcludedFromTimedMeetingAlerts

