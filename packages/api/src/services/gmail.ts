import { google } from 'googleapis'

const FIVE_MIN_MS = 5 * 60 * 1000

let cachedToken: { accessToken: string; expiryMs: number } | null = null

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

async function getRefreshToken(): Promise<string> {
  const envToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  if (envToken) return envToken

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    const params = new URLSearchParams({
      provider: 'eq.google',
      is_active: 'eq.true',
      limit: '1',
      select: 'refresh_token',
    })
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/calendar_connections?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (res.ok) {
      const data = await res.json()
      const token = data[0]?.refresh_token
      if (token) return token
    }
  }

  throw new Error(
    'לא נמצא refresh token עבור Gmail – יש לחבר את חשבון Google עם הרשאת gmail.readonly'
  )
}

export async function getGmailAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiryMs - FIVE_MIN_MS) {
    return cachedToken.accessToken
  }

  const refreshToken = await getRefreshToken()
  const oauth2Client = new google.auth.OAuth2(getClientId(), getClientSecret())
  oauth2Client.setCredentials({ refresh_token: refreshToken })

  const { credentials } = await oauth2Client.refreshAccessToken()
  const accessToken = credentials.access_token
  if (!accessToken) throw new Error('לא התקבל access token מ-Google Gmail')

  cachedToken = {
    accessToken,
    expiryMs: credentials.expiry_date ?? Date.now() + 3600 * 1000,
  }
  return accessToken
}

export interface GmailMessage {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  body: string
}

export async function searchGmailMessages(
  query: string,
  maxResults = 50
): Promise<GmailMessage[]> {
  const accessToken = await getGmailAccessToken()
  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: accessToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  })

  const messages = listRes.data.messages ?? []
  if (messages.length === 0) return []

  const results = await Promise.allSettled(
    messages.map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      })
      const headers = full.data.payload?.headers ?? []
      const hdr = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

      return {
        id: msg.id!,
        threadId: msg.threadId!,
        subject: hdr('Subject'),
        from: hdr('From'),
        date: hdr('Date'),
        body: extractBody(full.data.payload),
      } satisfies GmailMessage
    })
  )

  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<GmailMessage>).value)
}

function extractBody(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>

  if (p.body && typeof p.body === 'object') {
    const body = p.body as Record<string, unknown>
    if (typeof body.data === 'string') {
      return Buffer.from(body.data, 'base64').toString('utf-8')
    }
  }

  if (Array.isArray(p.parts)) {
    const textPart = p.parts.find(
      (pt: unknown) => (pt as Record<string, unknown>).mimeType === 'text/plain'
    ) as Record<string, unknown> | undefined
    if (textPart) {
      const body = textPart.body as Record<string, unknown> | undefined
      if (typeof body?.data === 'string') {
        return Buffer.from(body.data, 'base64').toString('utf-8')
      }
    }

    const htmlPart = p.parts.find(
      (pt: unknown) => (pt as Record<string, unknown>).mimeType === 'text/html'
    ) as Record<string, unknown> | undefined
    if (htmlPart) {
      const body = htmlPart.body as Record<string, unknown> | undefined
      if (typeof body?.data === 'string') {
        return Buffer.from(body.data, 'base64').toString('utf-8')
      }
    }

    // nested multipart
    for (const part of p.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ''
}
