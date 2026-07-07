import { type NextRequest, NextResponse } from 'next/server'
import { createServiceCaller } from '@/lib/api-caller'
import { pushAssistantMessage } from '@/lib/push-notifications'

/**
 * Cron endpoint to sync feed (RSS). Call periodically, e.g.:
 *   GET/POST /api/cron/feed-sync
 * Optional: pass Authorization: Bearer <CRON_SECRET> if CRON_SECRET env is set.
 * If FEED_SEND_TELEGRAM_DIGEST=1 and push channels are configured, sends a short digest.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runSync(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runSync(request)
}

async function runSync(_request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = _request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const caller = await createServiceCaller()
    const result = await caller.feed.sync()

    if (process.env.FEED_SEND_TELEGRAM_DIGEST) {
      try {
        const latest = await caller.feed.getLatest({ limit: 8 })
        if (latest.length > 0) {
          const lines = latest.map((i) => `• ${i.title}\n  ${i.sourceName}`)
          const digest = `📰 עדכון כלכלה וחדשות\n\n${lines.join('\n\n')}`
          await pushAssistantMessage(digest.slice(0, 4000), 'cron', { typeId: 'feed_digest' })
        }
      } catch (digestErr) {
        console.warn('[cron/feed-sync] Push digest failed:', digestErr)
      }
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/feed-sync]', err)
    const msg = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
