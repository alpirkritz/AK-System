import { google, calendar_v3 } from 'googleapis'
import {
  getAccessTokenForConnection,
  getConnectionForCalendarId,
  invalidateGoogleConnectionsCache,
  isGoogleIntegrationConfigured,
  listGoogleConnections,
  makeGoogleCalendarId,
  type GoogleConnection,
} from './google-connections'

export type RsvpStatus = 'accepted' | 'declined' | 'tentative' | 'needsAction'

export interface GoogleCalendarAttendee {
  email: string
  displayName?: string
  self?: boolean
  responseStatus?: string
}

export interface GoogleCalendarEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location?: string | null
  description?: string | null
  status?: string
  rsvp?: RsvpStatus
  calendarId?: string
  calendarName?: string
  calendarColor?: string
  htmlLink?: string | null
  attendees?: GoogleCalendarAttendee[]
  /** "transparent" = הצגה כ"פנוי" ביומן (free), "opaque" = תפוס */
  transparency?: 'opaque' | 'transparent'
  /** Google account that owns this event */
  accountEmail?: string
}

async function listCalendars(
  calendar: calendar_v3.Calendar
): Promise<Array<{ id: string; summary: string; backgroundColor?: string }>> {
  const res = await calendar.calendarList.list({ minAccessRole: 'reader' })
  return (res.data.items || [])
    .filter((c) => c.id && c.accessRole !== 'freeBusyReader')
    .filter((c) => !c.id!.endsWith('@import.calendar.google.com'))
    .map((c) => ({
      id: c.id!,
      summary: c.summary || c.id!,
      backgroundColor: c.backgroundColor || undefined,
    }))
}

async function fetchEventsFromCalendar(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<calendar_v3.Schema$Event[]> {
  const events: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined

  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
    })
    if (res.data.items) events.push(...res.data.items)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  return events
}

function mapGoogleEvent(
  e: calendar_v3.Schema$Event,
  cal: { id: string; summary: string; backgroundColor?: string },
  accountEmail: string
): GoogleCalendarEvent | null {
  if (!e.id) return null

  let rsvp: RsvpStatus | undefined
  if (e.attendees && e.attendees.length > 0) {
    const me = e.attendees.find((a) => a.self)
    if (me?.responseStatus) {
      const rs = me.responseStatus as string
      if (rs === 'accepted' || rs === 'declined' || rs === 'tentative' || rs === 'needsAction') {
        rsvp = rs as RsvpStatus
      }
    }
  } else {
    rsvp = 'accepted'
  }

  return {
    id: `${accountEmail}::${e.id}`,
    title: e.summary || '(ללא כותרת)',
    start: e.start?.dateTime || e.start?.date || new Date().toISOString(),
    end: e.end?.dateTime || e.end?.date || new Date().toISOString(),
    isAllDay: !e.start?.dateTime,
    location: e.location ?? null,
    description: e.description ?? null,
    status: e.status ?? undefined,
    rsvp,
    calendarId: makeGoogleCalendarId(accountEmail, cal.id),
    calendarName: `${cal.summary} (${accountEmail})`,
    calendarColor: cal.backgroundColor,
    htmlLink: e.htmlLink ?? null,
    attendees: (e.attendees ?? [])
      .map((a) => ({
        email: a.email ?? '',
        displayName: a.displayName ?? undefined,
        self: a.self ?? undefined,
        responseStatus: a.responseStatus ?? undefined,
      }))
      .filter((a) => a.email),
    transparency: (e.transparency as 'opaque' | 'transparent') ?? 'opaque',
    accountEmail,
  }
}

async function fetchEventsForConnection(
  conn: GoogleConnection,
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getAccessTokenForConnection(conn)
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

  const calendars = await listCalendars(calendarClient)
  if (calendars.length === 0) {
    calendars.push({ id: 'primary', summary: 'יומן ראשי' })
  }

  const results = await Promise.allSettled(
    calendars.map((cal) =>
      fetchEventsFromCalendar(calendarClient, cal.id, timeMin, timeMax).then((evs) =>
        evs.map((e) => ({ event: e, cal }))
      )
    )
  )

  const events: GoogleCalendarEvent[] = []
  const seenIds = new Set<string>()

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const { event: e, cal } of result.value) {
      const mapped = mapGoogleEvent(e, cal, conn.calendarEmail)
      if (!mapped) continue
      if (seenIds.has(mapped.id)) continue
      seenIds.add(mapped.id)
      events.push(mapped)
    }
  }

  return events
}

export async function fetchGoogleCalendarEvents(
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarEvent[]> {
  if (!isGoogleIntegrationConfigured()) return []

  try {
    const connections = await listGoogleConnections()
    if (connections.length === 0) return []

    const results = await Promise.allSettled(
      connections.map((conn) => fetchEventsForConnection(conn, timeMin, timeMax))
    )

    const allEvents: GoogleCalendarEvent[] = []
    const seenIds = new Set<string>()

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[Google Calendar] account fetch error:', result.reason)
        continue
      }
      for (const ev of result.value) {
        if (seenIds.has(ev.id)) continue
        seenIds.add(ev.id)
        allEvents.push(ev)
      }
    }

    allEvents.sort((a, b) => a.start.localeCompare(b.start))
    return allEvents
  } catch (err) {
    console.error('[Google Calendar]', err)
    throw err
  }
}

export function isGoogleCalendarConfigured(): boolean {
  return isGoogleIntegrationConfigured()
}

export function invalidateGoogleCalendarCache(): void {
  invalidateGoogleConnectionsCache()
}

/** דוחה אירוע ביומן גוגל (מעדכן תגובת המשתמש ל-declined) */
export async function declineGoogleEvent(eventId: string, calendarId: string): Promise<void> {
  const connections = await listGoogleConnections()
  const { conn, nativeCalendarId } = await getConnectionForCalendarId(calendarId, connections)

  const nativeEventId = eventId.includes('::') ? eventId.split('::').slice(1).join('::') : eventId

  const accessToken = await getAccessTokenForConnection(conn)
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

  const eventRes = await calendarClient.events.get({
    calendarId: nativeCalendarId,
    eventId: nativeEventId,
  })
  const event = eventRes.data
  const attendees = (event.attendees || []).map((a) =>
    a.self ? { ...a, responseStatus: 'declined' } : a
  )

  await calendarClient.events.patch({
    calendarId: nativeCalendarId,
    eventId: nativeEventId,
    requestBody: { attendees },
  })
}

export { listGoogleConnections, hasGoogleCalendarConnections } from './google-connections'
