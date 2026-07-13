import { randomUUID } from 'node:crypto'
import { google } from 'googleapis'
import {
  fetchGoogleConnectionsFromSqlite,
  updateGoogleAccessTokenSqlite,
  clearGoogleAccessTokenSqlite,
  upsertGoogleConnectionSqlite,
} from './google-connections-sqlite'

const FIVE_MIN_MS = 5 * 60 * 1000

export type GoogleConnection = {
  id: string
  calendarEmail: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
}

const tokenCache = new Map<string, { accessToken: string; expiryMs: number }>()
/** Skip Supabase for a few minutes after a fetch failure (dead URL, network). */
let supabaseUnavailableUntil = 0

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
  const hasClient = !!(
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
  )
  return hasClient && !!process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
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
  if (hasEnvGoogleCredentials()) return true
  if (hasSupabaseGoogleCredentials()) return true
  return !!(
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET)
  )
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
  if (Date.now() < supabaseUnavailableUntil) return []

  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []

  const params = new URLSearchParams({
    provider: 'eq.google',
    is_active: 'eq.true',
    select: 'id,calendar_email,access_token,refresh_token,token_expires_at',
    order: 'created_at.asc',
  })

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections?${params}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      console.warn('[Google] Supabase fetch failed:', res.status)
      supabaseUnavailableUntil = Date.now() + FIVE_MIN_MS
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
  } catch (err) {
    console.warn('[Google] Supabase fetch error:', err)
    supabaseUnavailableUntil = Date.now() + FIVE_MIN_MS
    return []
  }
}

async function supabaseGet(path: string): Promise<unknown[]> {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return []
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

async function supabasePatch(path: string, body: unknown): Promise<boolean> {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

async function supabasePost(body: unknown): Promise<boolean> {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Persist OAuth tokens to Supabase (when configured) and local SQLite. */
export async function upsertGoogleCalendarConnection(input: {
  userId: string
  calendarEmail: string
  accessToken: string
  refreshToken?: string
  tokenExpiresAt: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const existingSqlite = fetchGoogleConnectionsFromSqlite().find(
    (c) => c.calendarEmail.toLowerCase() === input.calendarEmail.toLowerCase(),
  )
  const existingSupabase = hasSupabaseGoogleCredentials()
    ? ((await supabaseGet(
        `calendar_connections?provider=eq.google&calendar_email=eq.${encodeURIComponent(input.calendarEmail)}&select=id,refresh_token&limit=1`,
      )) as Array<{ id: string; refresh_token: string | null }>)[0]
    : undefined

  const refreshToken =
    input.refreshToken ||
    existingSqlite?.refreshToken ||
    existingSupabase?.refresh_token ||
    ''

  if (!refreshToken) {
    return { ok: false, error: 'no_refresh_token' }
  }

  if (hasSupabaseGoogleCredentials()) {
    if (existingSupabase) {
      const patchBody: Record<string, unknown> = {
        access_token: input.accessToken,
        token_expires_at: input.tokenExpiresAt,
        calendar_email: input.calendarEmail,
        is_active: true,
      }
      if (input.refreshToken) patchBody.refresh_token = input.refreshToken
      await supabasePatch(`calendar_connections?id=eq.${existingSupabase.id}`, patchBody)
    } else {
      await supabasePost({
        id: randomUUID(),
        user_id: input.userId,
        provider: 'google',
        calendar_email: input.calendarEmail,
        access_token: input.accessToken,
        refresh_token: refreshToken,
        token_expires_at: input.tokenExpiresAt,
        is_active: true,
      })
    }
  }

  try {
    upsertGoogleConnectionSqlite({
      userId: input.userId,
      calendarEmail: input.calendarEmail,
      accessToken: input.accessToken,
      refreshToken,
      tokenExpiresAt: input.tokenExpiresAt,
    })
  } catch (err) {
    console.error('[Google] SQLite upsert failed:', err)
    return { ok: false, error: 'insert_failed' }
  }

  invalidateGoogleConnectionsCache()
  return { ok: true }
}

/** All configured Google connections (SQLite first, then Supabase, optional env fallback). */
export async function listGoogleConnections(): Promise<GoogleConnection[]> {
  const fromSqlite = fetchGoogleConnectionsFromSqlite()
  if (fromSqlite.length > 0) return fromSqlite

  // Mac bridge/cron sets DATABASE_PATH explicitly — don't fall through to dead Supabase.
  if (process.env.DATABASE_PATH) return fromSqlite

  if (hasSupabaseGoogleCredentials()) {
    const fromSupabase = await fetchGoogleConnectionsFromSupabase()
    if (fromSupabase.length > 0) return fromSupabase
  }

  if (hasEnvGoogleCredentials()) return [envConnection()]
  return []
}

/** True when at least one Google account can be queried (OAuth tokens present). */
export async function hasGoogleCalendarConnections(): Promise<boolean> {
  return (await listGoogleConnections()).length > 0
}

export function makeGoogleCalendarId(email: string, nativeCalendarId: string): string {
  return `google:${email}:${nativeCalendarId}`
}

/** Parse composite id or return null for legacy native ids. */
export function parseGoogleCalendarId(
  compositeId: string,
): { email: string; calendarId: string } | null {
  const match = compositeId.match(/^google:([^:]+):(.+)$/)
  if (!match) return null
  return { email: match[1], calendarId: match[2] }
}

export async function getAccessTokenForConnection(
  conn: GoogleConnection,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const cacheKey = conn.id
  const forceRefresh = options?.forceRefresh ?? false

  if (!forceRefresh) {
    const cached = tokenCache.get(cacheKey)
    if (cached && Date.now() < cached.expiryMs - FIVE_MIN_MS) {
      return cached.accessToken
    }

    const expiryMs = new Date(conn.tokenExpiresAt).getTime()
    if (conn.accessToken && Date.now() < expiryMs - FIVE_MIN_MS) {
      return conn.accessToken
    }
  }

  const oauth2Client = new google.auth.OAuth2(getClientId(), getClientSecret())
  oauth2Client.setCredentials({ refresh_token: conn.refreshToken })
  try {
    const { credentials } = await oauth2Client.refreshAccessToken()
    const accessToken = credentials.access_token
    if (!accessToken) throw new Error(`לא התקבל access token עבור ${conn.calendarEmail}`)

    const newExpiryMs = credentials.expiry_date ?? Date.now() + 3600 * 1000
    const tokenExpiresAt = new Date(newExpiryMs).toISOString()

    tokenCache.set(cacheKey, { accessToken, expiryMs: newExpiryMs })

    if (conn.id !== 'env') {
      try {
        updateGoogleAccessTokenSqlite({
          connectionId: conn.id,
          accessToken,
          tokenExpiresAt,
        })
      } catch (err) {
        console.warn('[Google] SQLite token persist failed:', err)
      }
      if (hasSupabaseGoogleCredentials() && Date.now() >= supabaseUnavailableUntil) {
        void supabasePatch(`calendar_connections?id=eq.${conn.id}`, {
          access_token: accessToken,
          token_expires_at: tokenExpiresAt,
        }).catch(() => {})
      }
      conn.accessToken = accessToken
      conn.tokenExpiresAt = tokenExpiresAt
    }

    return accessToken
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('invalid_grant') && conn.id !== 'env') {
      tokenCache.delete(cacheKey)
      try {
        clearGoogleAccessTokenSqlite(conn.id)
      } catch (clearErr) {
        console.warn('[Google] clear access token failed:', clearErr)
      }
      conn.accessToken = ''
      conn.tokenExpiresAt = new Date(0).toISOString()
    }
    throw err
  }
}

export async function getConnectionForCalendarId(
  compositeOrNativeId: string,
  connections?: GoogleConnection[],
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
  supabaseUnavailableUntil = 0
}
