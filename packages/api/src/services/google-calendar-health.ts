import { google } from 'googleapis'
import {
  getAccessTokenForConnection,
  listGoogleConnections,
  type GoogleConnection,
} from './google-connections'

export type GoogleAccountHealth = {
  email: string
  status: 'ok' | 'error'
  error?: string
  calendarCount?: number
}

function formatProbeError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message
    if (msg.includes('invalid_grant')) {
      return 'טוקן OAuth פג תוקף — נתק והתחבר מחדש מחשבון Google בהגדרות'
    }
    return msg
  }
  return String(err)
}

async function probeConnection(conn: GoogleConnection): Promise<GoogleAccountHealth> {
  try {
    const accessToken = await getAccessTokenForConnection(conn)
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client })
    const res = await calendarClient.calendarList.list({ minAccessRole: 'reader', maxResults: 1 })
    const count = res.data.items?.length ?? 0
    return {
      email: conn.calendarEmail,
      status: 'ok',
      calendarCount: count,
    }
  } catch (err) {
    return {
      email: conn.calendarEmail,
      status: 'error',
      error: formatProbeError(err),
    }
  }
}

/** Probe each stored Google connection — verifies token + Calendar API access. */
export async function probeGoogleCalendarHealth(): Promise<GoogleAccountHealth[]> {
  const connections = await listGoogleConnections()
  if (connections.length === 0) return []
  return Promise.all(connections.map(probeConnection))
}
