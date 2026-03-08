// Google OAuth: token exchange lives in @ak-system/api (do not import googleapis here)
import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCalendarCode } from '@ak-system/api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const callbackUrl = `${APP_URL}/api/auth/google-calendar/callback`

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
    const { access_token, refresh_token, expiry_date, email: calendarEmail } = await exchangeGoogleCalendarCode(code, callbackUrl)

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.redirect(`${APP_URL}/settings?google_error=missing_supabase_config`)
    }

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

    await supabasePatch(`calendar_connections?id=eq.${existing.id}`, {
      access_token,
      refresh_token,
      token_expires_at: new Date(expiry_date).toISOString(),
      calendar_email: calendarEmail,
      is_active: true,
    })

    return NextResponse.redirect(`${APP_URL}/settings?google_connected=1`)
  } catch (err) {
    console.error('[Google OAuth callback]', err)
    return NextResponse.redirect(`${APP_URL}/settings?google_error=oauth_failed`)
  }
}
