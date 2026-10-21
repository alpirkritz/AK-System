import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { buildCommitmentNotification, freshCommitments } from '@ak-system/api'
import { scanSlackCommitments } from '@ak-system/api/services/slack'
import { createNotification } from '@/lib/notification-store'

/**
 * Cron: every 10 minutes, propose commitments from new messages in enabled Slack channels.
 * Mirrors /api/cron/whatsapp-group-commitments. Does not write back to Slack.
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
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  try {
    const result = await scanSlackCommitments(getDb())
    const fresh = freshCommitments(result.proposed)
    if (fresh.length > 0) {
      const { title, body } = buildCommitmentNotification(fresh)
      await createNotification({ title, body, url: '/commitments', type: 'system' })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/slack-commitments]', err)
    const msg = err instanceof Error ? err.message : 'Slack commitment scan failed'
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
