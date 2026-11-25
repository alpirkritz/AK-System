import { type NextRequest, NextResponse } from 'next/server'
import { runReleaseNotesAgent } from '@/lib/release-notes-runner'

/**
 * Cron: announce NEW records of the Notion deploy-summaries database as
 * release notes in the WhatsApp "טכני" group. Run every 5 minutes.
 * Runs only while the agent's switch on /agents/manage is on. Draft mode
 * (default): the WhatsApp channel of `notion_release_notes` is off, so messages
 * only reach the in-app/push channels until it is enabled.
 * Optional: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

async function run(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await runReleaseNotesAgent()
    if (!result.ok) {
      console.error('[cron/notion-release-notes]', result.error)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/notion-release-notes]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 })
  }
}
