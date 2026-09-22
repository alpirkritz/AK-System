import { type NextRequest, NextResponse } from 'next/server'
import { getDb } from '@ak-system/database'
import {
  getSchedulablePreference,
  markNotificationSent,
  resolveNotificationChannels,
  runFollowedDailyDigest,
  wasNotificationSentInSlot,
  WHATSAPP_DAILY_DIGEST_TYPE,
} from '@ak-system/api'
import { sendBrowserPush } from '@/lib/web-push'
import { sendTelegramMessage } from '@/lib/telegram-bot'

function currentSlot(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * Cron: one readable briefing of every followed WhatsApp group.
 * Polled every 15 minutes; sends when the clock matches the preference (default 20:30).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runDailyDigest(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runDailyDigest(request)
}

async function runDailyDigest(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    const token = auth?.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const timezone = process.env.TIMEZONE || 'Asia/Jerusalem'
  const slot = currentSlot(timezone)
  const pref = await getSchedulablePreference(WHATSAPP_DAILY_DIGEST_TYPE)
  if (!pref.enabled) {
    return NextResponse.json({ ok: true, slot, skipped: 'disabled' })
  }
  if (pref.scheduleTimes.length > 0 && !pref.scheduleTimes.includes(slot)) {
    return NextResponse.json({ ok: true, slot, skipped: 'not-due' })
  }
  if (wasNotificationSentInSlot(pref.lastSentAt, slot, timezone)) {
    return NextResponse.json({ ok: true, slot, skipped: 'already-sent' })
  }

  const result = await runFollowedDailyDigest(getDb())
  if (!result.ok) {
    return NextResponse.json({ ok: false, slot, error: result.error || 'Digest failed' }, { status: 500 })
  }

  await markNotificationSent(WHATSAPP_DAILY_DIGEST_TYPE)

  if (result.notificationId && result.title && result.pushBody) {
    const channels = await resolveNotificationChannels(WHATSAPP_DAILY_DIGEST_TYPE)
    if (channels.push) {
      try {
        await sendBrowserPush(result.title, result.pushBody, '/notifications', {
          notificationId: result.notificationId,
        })
      } catch (err) {
        console.warn('[whatsapp-daily-digest] browser push failed:', err)
      }
    }
    const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
    if (channels.telegram && process.env.TELEGRAM_BOT_TOKEN && chatId && result.text) {
      try {
        await sendTelegramMessage(Number(chatId), result.text)
      } catch (err) {
        console.warn('[whatsapp-daily-digest] telegram failed:', err)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    slot,
    actionCount: result.actionCount,
    sectionCount: result.sectionCount,
    quietCount: result.quietCount,
    sent: Boolean(result.text),
  })
}
