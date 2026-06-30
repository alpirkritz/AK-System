import { type NextRequest, NextResponse } from 'next/server'
import { createMobileAccessToken, verifyGoogleIdToken } from '@/lib/mobile-auth'

/**
 * POST /api/auth/mobile/google — Helm app Google sign-in.
 * Body: { idToken: string }
 * Returns: { accessToken: string, user: { email, name } }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { idToken?: string }
    const idToken = body.idToken?.trim()
    if (!idToken) {
      return NextResponse.json({ error: 'idToken is required' }, { status: 400 })
    }

    const user = await verifyGoogleIdToken(idToken)
    if (!user) {
      return NextResponse.json({ error: 'Invalid or unauthorized Google token' }, { status: 401 })
    }

    const accessToken = await createMobileAccessToken(user)
    return NextResponse.json({
      accessToken,
      user: { email: user.email, name: user.name ?? user.email.split('@')[0] },
    })
  } catch (err) {
    console.error('[auth/mobile/google]', err)
    const msg = err instanceof Error ? err.message : 'Authentication failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
