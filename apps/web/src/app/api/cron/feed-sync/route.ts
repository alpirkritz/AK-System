import { type NextRequest, NextResponse } from 'next/server'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'
import { sendTelegramMessage } from '@/lib/telegram-bot'

/**
 * Cron endpoint to sync feed (RSS). Call periodically, e.g.:
 *   GET/POST /api/cron/feed-sync
 * Optional: pass Authorization: Bearer <CRON_SECRET> if CRON_SECRET env is set.
 * If FEED_SEND_TELEGRAM_DIGEST=1 and Telegram is configured, sends a short digest to the bot chat.
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
    const db = getDb()
    const ctx = await createContext({ db })
    const caller = appRouter.createCaller(ctx)
    const result = await caller.feed.sync()

    if (process.env.FEED_SEND_TELEGRAM_DIGEST && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_CHAT_ID) {
      try {
        const latest = await caller.feed.getLatest({ limit: 8 })
        if (latest.length > 0) {
          const lines = latest.map((i) => `• ${i.title}\n  ${i.sourceName}`)
          const digest = `📰 עדכון כלכלה וחדשות\n\n${lines.join('\n\n')}`
          const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID)
          await sendTelegramMessage(chatId, digest.slice(0, 4000))
        }
      } catch (digestErr) {
        console.warn('[cron/feed-sync] Telegram digest failed:', digestErr)
      }
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/feed-sync]', err)
    const msg = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
