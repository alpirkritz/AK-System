import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import { runWhatsappHealthCheck } from '@ak-system/api'
import { sendBrowserPush } from '@/lib/web-push'
import { sendTelegramMessage } from '@/lib/telegram-bot'

/**
 * Cron (every 15 min): alert when WhatsApp messages stop reaching the system, even while the
 * bridge claims to be connected. One alert per incident, a reminder every 12h, and a
 * "back online" message on recovery. Push + Telegram only.
 *
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
    if (token !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runWhatsappHealthCheck(getDb())
    if (result.title && result.text && result.channels) {
      if (result.channels.push) {
        try {
          await sendBrowserPush(result.title, result.text.slice(0, 240), '/settings/whatsapp', {
            notificationId: result.notificationId,
          })
        } catch (err) {
          console.warn('[cron/whatsapp-health] browser push failed:', err)
        }
      }
      const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
      if (result.channels.telegram && process.env.TELEGRAM_BOT_TOKEN && chatId) {
        try {
          await sendTelegramMessage(Number(chatId), `${result.title}\n\n${result.text}`)
        } catch (err) {
          console.warn('[cron/whatsapp-health] telegram failed:', err)
        }
      }
    }
    return NextResponse.json({
      ok: true,
      skipped: result.skipped,
      healthy: result.verdict?.healthy,
      problem: result.verdict?.problem,
      action: result.action,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'whatsapp health check failed'
    console.error('[cron/whatsapp-health]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
