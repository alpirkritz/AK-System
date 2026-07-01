import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getGoogleCalendarAuthUrl } from '@ak-system/api'
import { authOptions } from '@/lib/auth'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const callbackUrl = `${APP_URL}/api/auth/google-calendar/callback`

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const hint = request.nextUrl.searchParams.get('hint') || undefined
  const userId = session?.user?.id || 'default'
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64url')
  const authUrl = getGoogleCalendarAuthUrl(callbackUrl, { loginHint: hint, state })
  return NextResponse.redirect(authUrl)
}
