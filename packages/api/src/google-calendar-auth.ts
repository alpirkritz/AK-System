import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  // Write scope enables the Outlook→Dragontail bridge to create/update/delete
  // its own event copies. Supersedes calendar.events.readonly (which it includes).
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
]

export type GoogleCalendarAuthOptions = {
  loginHint?: string
  state?: string
}

export function getGoogleCalendarAuthUrl(
  callbackUrl: string,
  options: GoogleCalendarAuthOptions = {}
): string {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl
  )
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'select_account consent',
    include_granted_scopes: true,
    login_hint: options.loginHint,
    state: options.state,
  })
}

export async function exchangeGoogleCalendarCode(
  code: string,
  callbackUrl: string
): Promise<{ access_token: string; refresh_token: string; expiry_date: number; email: string }> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl
  )
  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
  const { data: userInfo } = await oauth2.userinfo.get()
  const email = userInfo.email || ''
  return {
    access_token: tokens.access_token || '',
    refresh_token: tokens.refresh_token || '',
    expiry_date: tokens.expiry_date || Date.now() + 3600000,
    email,
  }
}
