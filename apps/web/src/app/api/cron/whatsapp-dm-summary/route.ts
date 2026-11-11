import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { buildCommitmentNotification, summarizeDmChats } from '@ak-system/api'
import { createNotification } from '@/lib/notification-store'

/**
 * Cron: nightly summary of allowlisted WhatsApp 1:1 chats. Proposes commitments for review at
 * /commitments and leaves one in-app notification when new ones appear.
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
    const result = await summarizeDmChats(getDb())
    if (result.proposed.length > 0) {
      const { title, body } = buildCommitmentNotification(result.proposed)
      await createNotification({ title, body, url: '/commitments', type: 'system' })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/whatsapp-dm-summary]', err)
    const msg = err instanceof Error ? err.message : 'DM summary failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
