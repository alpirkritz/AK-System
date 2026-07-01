import { google } from 'googleapis'
import {
  getAccessTokenForConnection,
  listGoogleConnections,
} from './google-connections'

export interface GmailMessage {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  body: string
  accountEmail: string
}

async function searchGmailInAccount(
  conn: Awaited<ReturnType<typeof listGoogleConnections>>[number],
  query: string,
  maxResults: number
): Promise<GmailMessage[]> {
  const accessToken = await getAccessTokenForConnection(conn)
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
        id: `${conn.calendarEmail}::${msg.id!}`,
        threadId: msg.threadId!,
        subject: hdr('Subject'),
        from: hdr('From'),
        date: hdr('Date'),
        body: extractBody(full.data.payload),
        accountEmail: conn.calendarEmail,
      } satisfies GmailMessage
    })
  )

  return results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<GmailMessage>).value)
}

export async function searchGmailMessages(
  query: string,
  maxResults = 50
): Promise<GmailMessage[]> {
  const connections = await listGoogleConnections()
  if (connections.length === 0) {
    throw new Error(
      'לא נמצא refresh token עבור Gmail – יש לחבר את חשבון Google עם הרשאת gmail.readonly'
    )
  }

  const perAccount = Math.max(1, Math.ceil(maxResults / connections.length))
  const results = await Promise.allSettled(
    connections.map((conn) => searchGmailInAccount(conn, query, perAccount))
  )

  const merged: GmailMessage[] = []
  const seen = new Set<string>()

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[Gmail] account search error:', result.reason)
      continue
    }
    for (const msg of result.value) {
      const key = `${msg.accountEmail}:${msg.id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(msg)
    }
  }

  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return merged.slice(0, maxResults)
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

    for (const part of p.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ''
}
