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
  /** Master event id for recurring instances (account-namespaced); groups a series */
  recurringEventId?: string | null
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

export type GoogleCalendarCatalogEntry = {
  id: string
  name: string
  color: string
  source: 'google'
  accountEmail: string
}

/** List all Google sub-calendars across connected accounts (no events required). */
export async function listAllGoogleCalendars(): Promise<GoogleCalendarCatalogEntry[]> {
  if (!isGoogleIntegrationConfigured()) return []

  const connections = await listGoogleConnections()
  if (connections.length === 0) return []

  const entries: GoogleCalendarCatalogEntry[] = []

  for (const conn of connections) {
    try {
      const accessToken = await getAccessTokenForConnection(conn)
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: accessToken })
      const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

      let calendars = await listCalendars(calendarClient)
      if (calendars.length === 0) {
        calendars = [{ id: 'primary', summary: 'יומן ראשי' }]
      }

      for (const cal of calendars) {
        entries.push({
          id: makeGoogleCalendarId(conn.calendarEmail, cal.id),
          name: `${cal.summary} (${conn.calendarEmail})`,
          color: cal.backgroundColor || '#4285f4',
          source: 'google',
          accountEmail: conn.calendarEmail,
        })
      }
    } catch (err) {
      console.warn('[Google Calendar] catalog list error for', conn.calendarEmail, err)
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, 'he'))
  return entries
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

/**
 * Fetch a single sub-calendar with one retry on transient failure. A silent per-calendar
 * failure previously dropped that calendar's events (e.g. the work calendar holding the
 * day's timed meetings) with no error surfaced — see docs/specs/agent-calendar-data-parity.
 */
async function fetchEventsFromCalendarWithRetry(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<calendar_v3.Schema$Event[]> {
  try {
    return await fetchEventsFromCalendar(calendar, calendarId, timeMin, timeMax)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400))
    return fetchEventsFromCalendar(calendar, calendarId, timeMin, timeMax)
  }
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
    recurringEventId: e.recurringEventId ? `${accountEmail}::${e.recurringEventId}` : null,
  }
}

type ConnectionFetchResult = {
  events: GoogleCalendarEvent[]
  errors: GoogleCalendarFetchError[]
}

async function fetchEventsForConnection(
  conn: GoogleConnection,
  timeMin: Date,
  timeMax: Date,
  forceRefresh = false,
): Promise<ConnectionFetchResult> {
  const run = async (token: string): Promise<ConnectionFetchResult> => {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: token })
    const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

    const calendars = await listCalendars(calendarClient)
    if (calendars.length === 0) {
      calendars.push({ id: 'primary', summary: 'יומן ראשי' })
    }

    const results = await Promise.allSettled(
      calendars.map((cal) =>
        fetchEventsFromCalendarWithRetry(calendarClient, cal.id, timeMin, timeMax)
      )
    )

    const events: GoogleCalendarEvent[] = []
    const errors: GoogleCalendarFetchError[] = []
    const seenIds = new Set<string>()

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const cal = calendars[i]!
      if (result.status !== 'fulfilled') {
        // Surface the failure instead of silently dropping this calendar's events —
        // otherwise a transient failure hides the day's meetings and the agent
        // reports an empty day (docs/specs/agent-calendar-data-parity).
        const raw = result.reason instanceof Error ? result.reason.message : String(result.reason)
        console.warn('[Google Calendar] sub-calendar fetch error:', conn.calendarEmail, cal.summary, raw)
        errors.push({
          email: conn.calendarEmail,
          message: `היומן "${cal.summary}" לא נטען: ${raw.slice(0, 160)}`,
        })
        continue
      }
      for (const e of result.value) {
        const mapped = mapGoogleEvent(e, cal, conn.calendarEmail)
        if (!mapped) continue
        if (seenIds.has(mapped.id)) continue
        seenIds.add(mapped.id)
        events.push(mapped)
      }
    }

    return { events, errors }
  }

  try {
    const accessToken = await getAccessTokenForConnection(conn, { forceRefresh })
    return await run(accessToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const authError =
      msg.includes('invalid_grant') ||
      msg.includes('Invalid Credentials') ||
      msg.includes('UNAUTHENTICATED')
    if (!forceRefresh && authError) {
      const accessToken = await getAccessTokenForConnection(conn, { forceRefresh: true })
      return await run(accessToken)
    }
    throw err
  }
}

export type GoogleCalendarFetchError = {
  email: string
  message: string
}

export type GoogleCalendarFetchResult = {
  events: GoogleCalendarEvent[]
  errors: GoogleCalendarFetchError[]
}

function formatFetchError(email: string, err: unknown): GoogleCalendarFetchError {
  const raw = err instanceof Error ? err.message : String(err)
  const message = raw.includes('invalid_grant')
    ? 'טוקן OAuth פג תוקף — נתק והתחבר מחדש מחשבון Google בהגדרות'
    : raw
  return { email, message }
}

export async function fetchGoogleCalendarEvents(
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarFetchResult> {
  if (!isGoogleIntegrationConfigured()) return { events: [], errors: [] }

  try {
    const connections = await listGoogleConnections()
    if (connections.length === 0) return { events: [], errors: [] }

    const results = await Promise.allSettled(
      connections.map((conn) => fetchEventsForConnection(conn, timeMin, timeMax))
    )

    const allEvents: GoogleCalendarEvent[] = []
    const errors: GoogleCalendarFetchError[] = []
    const seenIds = new Set<string>()

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const email = connections[i]!.calendarEmail
      if (result.status === 'rejected') {
        const err = formatFetchError(email, result.reason)
        console.warn('[Google Calendar] account fetch error:', email, result.reason)
        errors.push(err)
        continue
      }
      // Bubble up per-sub-calendar failures so callers can warn the user.
      errors.push(...result.value.errors)
      for (const ev of result.value.events) {
        if (seenIds.has(ev.id)) continue
        seenIds.add(ev.id)
        allEvents.push(ev)
      }
    }

    allEvents.sort((a, b) => a.start.localeCompare(b.start))
    return { events: allEvents, errors }
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
    sendUpdates: 'none',
    requestBody: { attendees },
  })
}

export { listGoogleConnections, hasGoogleCalendarConnections } from './google-connections'
