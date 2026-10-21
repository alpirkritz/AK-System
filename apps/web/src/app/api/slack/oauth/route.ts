import { type NextRequest, NextResponse } from 'next/server'
import { buildSlackInstallUrl } from '@ak-system/api/services/slack'

/**
 * GET /api/slack/oauth
 * Redirects the user to Slack's OAuth authorization page.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'SLACK_CLIENT_ID is not configured' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${appUrl}/api/slack/oauth/callback`
  const state = crypto.randomUUID()

  const url = buildSlackInstallUrl(redirectUri, state)
  return NextResponse.redirect(url)
}
