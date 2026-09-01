import { google } from 'googleapis'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  // Write scope enables the Outlook→Dragontail bridge to create/update/delete
  // its own event copies. Supersedes calendar.events.readonly (which it includes).
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
]

export type GoogleCalendarOAuthReturnTo = 'web' | 'mobile'

export type GoogleCalendarOAuthState = {
  userId: string
  returnTo?: GoogleCalendarOAuthReturnTo
}

export type GoogleCalendarAuthOptions = {
  loginHint?: string
  state?: string
}

export const MOBILE_CALENDAR_OAUTH_SCHEME = 'helm://calendar'

export function encodeGoogleCalendarOAuthState(input: GoogleCalendarOAuthState): string {
  return Buffer.from(
    JSON.stringify({
      userId: input.userId.trim() || 'default',
      returnTo: input.returnTo === 'mobile' ? 'mobile' : 'web',
    }),
  ).toString('base64url')
}

export function parseGoogleCalendarOAuthState(state: string | null): GoogleCalendarOAuthState {
  if (!state) return { userId: 'default', returnTo: 'web' }
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as {
      userId?: string
      returnTo?: string
    }
    return {
      userId: parsed.userId?.trim() || 'default',
      returnTo: parsed.returnTo === 'mobile' ? 'mobile' : 'web',
    }
  } catch {
    return { userId: 'default', returnTo: 'web' }
  }
}

export function googleCalendarOAuthFinishUrl(opts: {
  returnTo: GoogleCalendarOAuthReturnTo
  appUrl: string
  email?: string
  error?: string
}): string {
  const params = new URLSearchParams()
  if (opts.error) {
    params.set('google_error', opts.error)
  } else {
    params.set('google_connected', '1')
    if (opts.email) params.set('email', opts.email)
  }
  const query = params.toString()
  if (opts.returnTo === 'mobile') {
    return `${MOBILE_CALENDAR_OAUTH_SCHEME}?${query}`
  }
  return `${opts.appUrl.replace(/\/$/, '')}/settings?${query}`
}

export function googleCalendarOAuthLandingHtml(targetUrl: string, error?: string): string {
  const title = error ? 'שגיאת חיבור ליומן' : 'היומן חובר'
  const body = error
    ? 'לא הצלחנו לחבר את היומן. אפשר לחזור לאפליקציה ולנסות שוב.'
    : 'חוזרים לאפליקציה…'
  const safeTarget = JSON.stringify(targetUrl)
  return `<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#0e1626;color:#eef3fb;padding:32px;text-align:center">
<p>${body}</p>
<p><a href=${safeTarget} style="color:#2dd4bf">חזרה ל-ARO</a></p>
<script>location.replace(${safeTarget})</script>
</body>
</html>`
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
