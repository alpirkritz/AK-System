import { google, calendar_v3 } from 'googleapis'

const FIVE_MIN_MS = 5 * 60 * 1000

let cachedToken: { accessToken: string; expiryMs: number } | null = null
let connectionSource: 'supabase' | 'env' | null = null
let supabaseConnection: {
  access_token: string
  refresh_token: string
  token_expires_at: string
} | null = null

function getEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`חסר משתנה סביבה: ${name}`)
  return v
}

function hasEnvCredentials(): boolean {
  return !!(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  )
}

function getSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
}

function hasSupabaseCredentials(): boolean {
  return !!(
    getSupabaseUrl() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
  )
}

/** טוען חיבור גוגל קלנדר מ-Supabase (אותו פרויקט כמו ב-Personal_Assistant) */
async function fetchConnectionFromSupabase(): Promise<{
  access_token: string
  refresh_token: string
  token_expires_at: string
} | null> {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const params = new URLSearchParams({
    provider: 'eq.google',
    is_active: 'eq.true',
    limit: '1',
    select: 'access_token,refresh_token,token_expires_at',
  })
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    console.warn('[Google Calendar] Supabase fetch failed:', res.status)
    return null
  }
  const data = await res.json()
  const row = Array.isArray(data) ? data[0] : null
  if (!row?.refresh_token) return null
  return {
    access_token: row.access_token || '',
    refresh_token: row.refresh_token,
    token_expires_at: row.token_expires_at || new Date(Date.now() + 3600000).toISOString(),
  }
}

function isConfigured(): boolean {
  return hasEnvCredentials() || hasSupabaseCredentials()
}

async function getConnection(): Promise<{
  access_token: string
  refresh_token: string
  token_expires_at: string
}> {
  if (connectionSource === 'supabase' && supabaseConnection) {
    return supabaseConnection
  }
  if (connectionSource === 'env') {
    return {
      access_token: process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || '',
      refresh_token: getEnv('GOOGLE_CALENDAR_REFRESH_TOKEN'),
      token_expires_at:
        process.env.GOOGLE_CALENDAR_TOKEN_EXPIRES_AT ||
        new Date(Date.now() + 3600000).toISOString(),
    }
  }

  if (hasSupabaseCredentials()) {
    const conn = await fetchConnectionFromSupabase()
    if (conn) {
      connectionSource = 'supabase'
      supabaseConnection = conn
      return conn
    }
  }

  if (hasEnvCredentials()) {
    connectionSource = 'env'
    return {
      access_token: process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || '',
      refresh_token: getEnv('GOOGLE_CALENDAR_REFRESH_TOKEN'),
      token_expires_at:
        process.env.GOOGLE_CALENDAR_TOKEN_EXPIRES_AT ||
        new Date(Date.now() + 3600000).toISOString(),
    }
  }

  throw new Error('לא הוגדר חיבור ליומן גוגל (env או Supabase)')
}

async function getValidAccessToken(): Promise<string> {
  const conn = await getConnection()
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('חסרים GOOGLE_CALENDAR_CLIENT_ID או GOOGLE_CALENDAR_CLIENT_SECRET')
  }

  const expiryMs = new Date(conn.token_expires_at).getTime()
  if (cachedToken && Date.now() < cachedToken.expiryMs - FIVE_MIN_MS) {
    return cachedToken.accessToken
  }
  if (conn.access_token && Date.now() < expiryMs - FIVE_MIN_MS) {
    return conn.access_token
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token })

  const { credentials } = await oauth2Client.refreshAccessToken()
  const accessToken = credentials.access_token
  if (!accessToken) throw new Error('לא התקבל access token מ-Google')

  const newExpiryMs = credentials.expiry_date ?? Date.now() + 3600 * 1000
  cachedToken = { accessToken, expiryMs: newExpiryMs }
  return accessToken
}

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
}

/** מחזיר את רשימת כל היומנים של המשתמש */
async function listCalendars(calendar: calendar_v3.Calendar): Promise<
  Array<{ id: string; summary: string; backgroundColor?: string }>
> {
  const res = await calendar.calendarList.list({ minAccessRole: 'reader' })
  return (res.data.items || [])
    .filter((c) => c.id && c.accessRole !== 'freeBusyReader')
    .map((c) => ({
      id: c.id!,
      summary: c.summary || c.id!,
      backgroundColor: c.backgroundColor || undefined,
    }))
}

/** שואב אירועים מיומן בודד עם pagination */
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

export async function fetchGoogleCalendarEvents(
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarEvent[]> {
  if (!isConfigured()) return []

  try {
    const accessToken = await getValidAccessToken()
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

    // שלב 1: רשימת כל היומנים
    const calendars = await listCalendars(calendarClient)
    if (calendars.length === 0) {
      // fallback ליומן ראשי אם listCalendars כשל
      calendars.push({ id: 'primary', summary: 'יומן ראשי' })
    }

    // שלב 2: שאיבה מקבילה מכל היומנים
    const results = await Promise.allSettled(
      calendars.map((cal) =>
        fetchEventsFromCalendar(calendarClient, cal.id, timeMin, timeMax).then((evs) =>
          evs.map((e) => ({ event: e, cal }))
        )
      )
    )

    const seenIds = new Set<string>()
    const allEvents: GoogleCalendarEvent[] = []

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const { event: e, cal } of result.value) {
        if (!e.id) continue
        // מניעת כפילויות (אותו אירוע יכול להופיע ביומנים משותפים)
        if (seenIds.has(e.id)) continue
        seenIds.add(e.id)

        // Extract current user's RSVP from attendees (self:true attendee)
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
          // No attendees = personal event = implicitly accepted
          rsvp = 'accepted'
        }

        allEvents.push({
          id: e.id,
          title: e.summary || '(ללא כותרת)',
          start: e.start?.dateTime || e.start?.date || new Date().toISOString(),
          end: e.end?.dateTime || e.end?.date || new Date().toISOString(),
          isAllDay: !e.start?.dateTime,
          location: e.location ?? null,
          description: e.description ?? null,
          status: e.status ?? undefined,
          rsvp,
          calendarId: cal.id,
          calendarName: cal.summary,
          calendarColor: cal.backgroundColor,
          htmlLink: e.htmlLink ?? null,
          attendees: (e.attendees ?? []).map((a) => ({
            email: a.email ?? '',
            displayName: a.displayName ?? undefined,
            self: a.self ?? undefined,
            responseStatus: a.responseStatus ?? undefined,
          })).filter((a) => a.email),
          transparency: (e.transparency as 'opaque' | 'transparent') ?? 'opaque',
        })
      }
    }

    // מיון לפי שעת התחלה
    allEvents.sort((a, b) => a.start.localeCompare(b.start))
    return allEvents
  } catch (err) {
    console.error('[Google Calendar]', err)
    throw err
  }
}

export function isGoogleCalendarConfigured(): boolean {
  return isConfigured()
}

/** דוחה אירוע ביומן גוגל (מעדכן תגובת המשתמש ל-declined) */
export async function declineGoogleEvent(eventId: string, calendarId: string): Promise<void> {
  const accessToken = await getValidAccessToken()
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })

  const eventRes = await calendarClient.events.get({ calendarId, eventId })
  const event = eventRes.data
  const attendees = (event.attendees || []).map((a) =>
    a.self ? { ...a, responseStatus: 'declined' } : a
  )

  await calendarClient.events.patch({
    calendarId,
    eventId,
    requestBody: { attendees },
  })
}
