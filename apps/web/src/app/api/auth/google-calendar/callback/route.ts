import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  `${APP_URL}/api/auth/google-calendar/callback`
)

async function supabaseGet(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  })
  if (!res.ok) return []
  return res.json()
}

async function supabasePatch(path: string, body: unknown) {
  return fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
}


export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${APP_URL}/settings?google_error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${APP_URL}/settings?google_error=no_code`)
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get the user's email from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()
    const calendarEmail = userInfo.email || ''

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.redirect(`${APP_URL}/settings?google_error=missing_supabase_config`)
    }

    // Find existing connection for this Google account
    const byEmail = await supabaseGet(
      `calendar_connections?provider=eq.google&calendar_email=eq.${encodeURIComponent(calendarEmail)}&select=id,user_id&limit=1`
    ) as Array<{ id: string; user_id: string }>

    const byProvider = byEmail.length === 0
      ? await supabaseGet(
          `calendar_connections?provider=eq.google&select=id,user_id&limit=1`
        ) as Array<{ id: string; user_id: string }>
      : []

    const existing = byEmail[0] ?? byProvider[0] ?? null

    if (!existing) {
      return NextResponse.redirect(`${APP_URL}/settings?google_error=no_existing_user`)
    }

    // PATCH the existing row — preserves user_id and any other columns
    await supabasePatch(`calendar_connections?id=eq.${existing.id}`, {
      access_token: tokens.access_token || '',
      refresh_token: tokens.refresh_token || '',
      token_expires_at: new Date(tokens.expiry_date || Date.now() + 3600000).toISOString(),
      calendar_email: calendarEmail,
      is_active: true,
    })

    return NextResponse.redirect(`${APP_URL}/settings?google_connected=1`)
  } catch (err) {
    console.error('[Google OAuth callback]', err)
    return NextResponse.redirect(`${APP_URL}/settings?google_error=oauth_failed`)
  }
}

