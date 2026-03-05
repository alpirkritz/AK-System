/**
 * ICS calendar integration — fetches events from one or more ICS feed URLs
 * (e.g. Outlook, Google Calendar export). Configure via ICS_FEED_URLS env
 * (comma-separated list of URLs).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ical = require('node-ical') as typeof import('node-ical')

export interface ICSCalendarEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location: string | null
  description: string | null
  status: string | null
  calendarId: string
  calendarName: string
  source: 'ics'
}

const DEFAULT_CALENDAR_NAME = 'ICS'

function getFeedUrls(): string[] {
  const urls = process.env.ICS_FEED_URLS
  if (!urls || typeof urls !== 'string') return []
  return urls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
}

function isICSAvailable(): boolean {
  return getFeedUrls().length > 0
}

/** Parse a single VEVENT from node-ical into our shape */
function eventFromIcal(ev: { type?: string; uid?: string; summary?: string; start?: Date; end?: Date; location?: string; description?: string }, calendarId: string, calendarName: string): ICSCalendarEvent | null {
  if (ev.type !== 'VEVENT' || !ev.start) return null
  const start = ev.start instanceof Date ? ev.start : new Date(ev.start as unknown as string)
  const end = ev.end != null
    ? (ev.end instanceof Date ? ev.end : new Date(ev.end as unknown as string))
    : new Date(start.getTime() + 3600000)
  const isAllDay = start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0
  const id = (ev.uid as string) || `ics-${calendarId}-${start.getTime()}`
  return {
    id,
    title: (ev.summary as string) || '(ללא כותרת)',
    start: start.toISOString(),
    end: end.toISOString(),
    isAllDay,
    location: (ev.location as string) ?? null,
    description: (ev.description as string) ?? null,
    status: null,
    calendarId,
    calendarName,
    source: 'ics',
  }
}

export async function fetchICSCalendarEvents(timeMin: Date, timeMax: Date): Promise<ICSCalendarEvent[]> {
  const urls = getFeedUrls()
  if (urls.length === 0) return []

  const allEvents: ICSCalendarEvent[] = []
  const timeMinMs = timeMin.getTime()
  const timeMaxMs = timeMax.getTime()

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    const calendarId = `ics-${i}`
    const calendarName = url.includes('outlook') ? 'Outlook' : DEFAULT_CALENDAR_NAME
    try {
      const data = await ical.async.fromURL(url)
      if (!data || typeof data !== 'object') continue
      for (const key of Object.keys(data)) {
        const ev = data[key]
        if (!ev || ev.type !== 'VEVENT') continue
        const parsed = eventFromIcal(ev, calendarId, calendarName)
        if (!parsed) continue
        const startMs = new Date(parsed.start).getTime()
        const endMs = new Date(parsed.end).getTime()
        if (endMs < timeMinMs || startMs > timeMaxMs) continue
        allEvents.push(parsed)
      }
    } catch (err) {
      console.warn('[ICS Calendar] Failed to fetch', url, err)
    }
  }

  allEvents.sort((a, b) => a.start.localeCompare(b.start))
  return allEvents
}

export function isICSCalendarConfigured(): boolean {
  return isICSAvailable()
}
