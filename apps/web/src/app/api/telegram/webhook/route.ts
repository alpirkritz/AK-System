import { type NextRequest, NextResponse } from 'next/server'
import { handleTelegramUpdate, type TelegramUpdate } from '@/lib/telegram-bot'

/**
 * Telegram webhook — receives updates from the Telegram Bot API.
 *
 * Register the webhook once:
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<YOUR_DOMAIN>/api/telegram/webhook"
 *
 * To find your chat ID, send any message to your bot and call:
 *   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
 * Then set TELEGRAM_ALLOWED_CHAT_ID to the `chat.id` from the response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Process synchronously — Telegram waits up to 60 s for a response.
  // For a personal bot the Gemini + tRPC round-trip stays well under that.
  try {
    await handleTelegramUpdate(update)
  } catch (err) {
    console.error('[Telegram Webhook] Unhandled error:', err)
  }

  // Always return 200 so Telegram does not retry the update.
  return NextResponse.json({ ok: true })
}
