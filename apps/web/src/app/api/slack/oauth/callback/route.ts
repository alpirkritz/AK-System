import { type NextRequest, NextResponse } from 'next/server'
import { exchangeSlackCode, upsertConnection, syncChannels, syncSlackUsers } from '@ak-system/api/services/slack'
import { getDb } from '@ak-system/database'

/**
 * GET /api/slack/oauth/callback
 * Handles the OAuth redirect from Slack, exchanges the code for a bot token, and
 * persists the connection. Then syncs channels and users.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings/slack?error=${encodeURIComponent(error)}`, request.url),
    )
  }
  if (!code) {
    return NextResponse.redirect(new URL('/settings/slack?error=no_code', request.url))
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/slack/oauth/callback`

    const tokens = await exchangeSlackCode(code, redirectUri)
    const db = getDb()
    await upsertConnection(db, tokens)
    // Kick off background sync — errors are non-fatal
    syncChannels(db).catch(() => {})
    syncSlackUsers(db).catch(() => {})

    return NextResponse.redirect(new URL('/settings/slack?connected=1', request.url))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.error('[Slack OAuth callback]', msg)
    return NextResponse.redirect(
      new URL(`/settings/slack?error=${encodeURIComponent(msg)}`, request.url),
    )
  }
}
