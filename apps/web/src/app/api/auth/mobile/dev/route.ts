import { type NextRequest, NextResponse } from 'next/server'
import { createMobileAccessToken } from '@/lib/mobile-auth'

const DEV_USER = {
  sub: 'dev',
  email: 'dev@local',
  name: 'Developer',
} as const

/**
 * POST /api/auth/mobile/dev — local Helm sign-in without Google.
 * Available only when NODE_ENV === 'development'.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const accessToken = await createMobileAccessToken(DEV_USER)
    return NextResponse.json({
      accessToken,
      user: { email: DEV_USER.email, name: DEV_USER.name },
    })
  } catch (err) {
    console.error('[auth/mobile/dev]', err)
    const msg = err instanceof Error ? err.message : 'Authentication failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
