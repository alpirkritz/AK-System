// Google OAuth: token exchange lives in @ak-system/api (do not import googleapis here)
import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeGoogleCalendarCode,
  googleCalendarOAuthFinishUrl,
  googleCalendarOAuthLandingHtml,
  parseGoogleCalendarOAuthState,
  upsertGoogleCalendarConnection,
} from '@ak-system/api'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const callbackUrl = `${APP_URL}/api/auth/google-calendar/callback`

function finishResponse(opts: {
  returnTo: 'web' | 'mobile'
  email?: string
  error?: string
}): NextResponse {
  const target = googleCalendarOAuthFinishUrl({
    returnTo: opts.returnTo,
    appUrl: APP_URL,
    email: opts.email,
    error: opts.error,
  })
  if (opts.returnTo === 'mobile') {
    return new NextResponse(googleCalendarOAuthLandingHtml(target, opts.error), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  return NextResponse.redirect(target)
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const { userId, returnTo } = parseGoogleCalendarOAuthState(searchParams.get('state'))

  if (error) {
    return finishResponse({ returnTo, error })
  }
  if (!code) {
    return finishResponse({ returnTo, error: 'no_code' })
  }

  try {
    const { access_token, refresh_token, expiry_date, email: calendarEmail } =
      await exchangeGoogleCalendarCode(code, callbackUrl)

    const result = await upsertGoogleCalendarConnection({
      userId,
      calendarEmail,
      accessToken: access_token,
      refreshToken: refresh_token || undefined,
      tokenExpiresAt: new Date(expiry_date).toISOString(),
    })

    if (!result.ok) {
      return finishResponse({ returnTo, error: result.error })
    }

    return finishResponse({ returnTo, email: calendarEmail })
  } catch (err) {
    console.error('[Google OAuth callback]', err)
    return finishResponse({ returnTo, error: 'oauth_failed' })
  }
}
