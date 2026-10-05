import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { buildCommitmentNotification, scanGroupCommitments } from '@ak-system/api'
import { createNotification } from '@/lib/notification-store'

/**
 * Cron: every 10 minutes, propose commitments from new messages in enabled WhatsApp groups.
 * Mirrors /api/cron/whatsapp-dm-commitments but scans group chats instead of 1:1 chats.
 * A message only becomes a commitment when its sender resolves to a known person (the owner or a
 * linked contact); unidentified senders are skipped. Does not send anything into the group.
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
    const result = await scanGroupCommitments(getDb())
    if (result.proposed.length > 0) {
      const { title, body } = buildCommitmentNotification(result.proposed)
      await createNotification({ title, body, url: '/commitments', type: 'system' })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/whatsapp-group-commitments]', err)
    const msg = err instanceof Error ? err.message : 'Group commitment scan failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
