// Google OAuth: token exchange lives in @ak-system/api (do not import googleapis here)
import { NextRequest, NextResponse } from 'next/server'
import { exchangeGoogleCalendarCode, upsertGoogleCalendarConnection } from '@ak-system/api'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const callbackUrl = `${APP_URL}/api/auth/google-calendar/callback`

function parseUserIdFromState(state: string | null): string {
  if (!state) return 'default'
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { userId?: string }
    return parsed.userId?.trim() || 'default'
  } catch {
    return 'default'
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error) {
    return NextResponse.redirect(`${APP_URL}/settings?google_error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${APP_URL}/settings?google_error=no_code`)
  }

  try {
    const { access_token, refresh_token, expiry_date, email: calendarEmail } =
      await exchangeGoogleCalendarCode(code, callbackUrl)

    const result = await upsertGoogleCalendarConnection({
      userId: parseUserIdFromState(state),
      calendarEmail,
      accessToken: access_token,
      refreshToken: refresh_token || undefined,
      tokenExpiresAt: new Date(expiry_date).toISOString(),
    })

    if (!result.ok) {
      return NextResponse.redirect(`${APP_URL}/settings?google_error=${result.error}`)
    }

    return NextResponse.redirect(
      `${APP_URL}/settings?google_connected=1&email=${encodeURIComponent(calendarEmail)}`,
    )
  } catch (err) {
    console.error('[Google OAuth callback]', err)
    return NextResponse.redirect(`${APP_URL}/settings?google_error=oauth_failed`)
  }
}
