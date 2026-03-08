import { NextResponse } from 'next/server'
import { getGoogleCalendarAuthUrl } from '@ak-system/api'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const callbackUrl = `${APP_URL}/api/auth/google-calendar/callback`

export async function GET() {
  const authUrl = getGoogleCalendarAuthUrl(callbackUrl)
  return NextResponse.redirect(authUrl)
}
