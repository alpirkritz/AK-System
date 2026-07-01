import { google } from 'googleapis'

const FIVE_MIN_MS = 5 * 60 * 1000

export type GoogleConnection = {
  id: string
  calendarEmail: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
}

const tokenCache = new Map<string, { accessToken: string; expiryMs: number }>()

function getClientId(): string {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  if (!id) throw new Error('חסר GOOGLE_CLIENT_ID')
  return id
}

function getClientSecret(): string {
  const s = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  if (!s) throw new Error('חסר GOOGLE_CLIENT_SECRET')
  return s
}

function getSupabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
}

export function hasEnvGoogleCredentials(): boolean {
  return !!(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  )
}

export function hasSupabaseGoogleCredentials(): boolean {
  return !!(
    getSupabaseUrl() &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
  )
}

export function isGoogleIntegrationConfigured(): boolean {
  return hasEnvGoogleCredentials() || hasSupabaseGoogleCredentials()
}

function envConnection(): GoogleConnection {
  return {
    id: 'env',
    calendarEmail: process.env.GOOGLE_CALENDAR_EMAIL || 'env@local',
    accessToken: process.env.GOOGLE_CALENDAR_ACCESS_TOKEN || '',
    refreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || '',
    tokenExpiresAt:
      process.env.GOOGLE_CALENDAR_TOKEN_EXPIRES_AT ||
      new Date(Date.now() + 3600000).toISOString(),
  }
}

/** Fetch all active Google connections from Supabase. */
export async function fetchGoogleConnectionsFromSupabase(): Promise<GoogleConnection[]> {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []

  const params = new URLSearchParams({
    provider: 'eq.google',
    is_active: 'eq.true',
    select: 'id,calendar_email,access_token,refresh_token,token_expires_at',
    order: 'created_at.asc',
  })
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    console.warn('[Google] Supabase fetch failed:', res.status)
    return []
  }
  const data = (await res.json()) as Array<{
    id: string
    calendar_email: string | null
    access_token: string | null
    refresh_token: string | null
    token_expires_at: string | null
  }>
  return data
    .filter((row) => row.refresh_token)
    .map((row) => ({
      id: row.id,
      calendarEmail: row.calendar_email || 'unknown',
      accessToken: row.access_token || '',
      refreshToken: row.refresh_token!,
      tokenExpiresAt: row.token_expires_at || new Date(Date.now() + 3600000).toISOString(),
    }))
}

/** All configured Google connections (Supabase rows + optional env fallback). */
export async function listGoogleConnections(): Promise<GoogleConnection[]> {
  const fromDb = hasSupabaseGoogleCredentials() ? await fetchGoogleConnectionsFromSupabase() : []
  if (fromDb.length > 0) return fromDb
  if (hasEnvGoogleCredentials()) return [envConnection()]
  return []
}

export function makeGoogleCalendarId(email: string, nativeCalendarId: string): string {
  return `google:${email}:${nativeCalendarId}`
}

/** Parse composite id or return null for legacy native ids. */
export function parseGoogleCalendarId(
  compositeId: string
): { email: string; calendarId: string } | null {
  const match = compositeId.match(/^google:([^:]+):(.+)$/)
  if (!match) return null
  return { email: match[1], calendarId: match[2] }
}

export async function getAccessTokenForConnection(conn: GoogleConnection): Promise<string> {
  const cacheKey = conn.id
  const cached = tokenCache.get(cacheKey)
  if (cached && Date.now() < cached.expiryMs - FIVE_MIN_MS) {
    return cached.accessToken
  }

  const expiryMs = new Date(conn.tokenExpiresAt).getTime()
  if (conn.accessToken && Date.now() < expiryMs - FIVE_MIN_MS) {
    return conn.accessToken
  }

  const oauth2Client = new google.auth.OAuth2(getClientId(), getClientSecret())
  oauth2Client.setCredentials({ refresh_token: conn.refreshToken })
  const { credentials } = await oauth2Client.refreshAccessToken()
  const accessToken = credentials.access_token
  if (!accessToken) throw new Error(`לא התקבל access token עבור ${conn.calendarEmail}`)

  tokenCache.set(cacheKey, {
    accessToken,
    expiryMs: credentials.expiry_date ?? Date.now() + 3600 * 1000,
  })
  return accessToken
}

export async function getConnectionForCalendarId(
  compositeOrNativeId: string,
  connections?: GoogleConnection[]
): Promise<{ conn: GoogleConnection; nativeCalendarId: string }> {
  const all = connections ?? (await listGoogleConnections())
  if (all.length === 0) throw new Error('לא הוגדר חיבור Google')

  const parsed = parseGoogleCalendarId(compositeOrNativeId)
  if (parsed) {
    const conn = all.find((c) => c.calendarEmail.toLowerCase() === parsed.email.toLowerCase())
    if (!conn) throw new Error(`לא נמצא חיבור עבור ${parsed.email}`)
    return { conn, nativeCalendarId: parsed.calendarId }
  }

  return { conn: all[0], nativeCalendarId: compositeOrNativeId }
}

export function invalidateGoogleConnectionsCache(): void {
  tokenCache.clear()
}
