import { saveChatMessage } from './conversation-engine'
import { isWhatsAppConfigured, sendWhatsAppMessage } from './whatsapp-bot'
import { sendTelegramMessage } from './telegram-bot'
import { sendBrowserPush } from './web-push'
import { sendExpoPush } from './expo-push'
import { createNotification } from './notification-store'
import { resolveNotificationChannels } from '@ak-system/api'

function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

/** Derive a short notification title from the first line of the message. */
function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'AK System'
  return firstLine.length > 60 ? firstLine.slice(0, 59) + '…' : firstLine
}

/**
 * Push an assistant message to every channel: Web Push (phone), Telegram, WhatsApp.
 * Always persists to chat_messages with the given source (default: cron).
 *
 * When `options.typeId` is provided, per-type notification preferences gate each
 * channel; a fully disabled type skips everything (no chat/notification write).
 */
export async function pushAssistantMessage(
  text: string,
  source: 'cron' | 'whatsapp' = 'cron',
  options?: { title?: string; url?: string; typeId?: string },
): Promise<{ telegram: boolean; whatsapp: boolean; webPush: number; expoPush: number; skipped?: boolean }> {
  const channels = options?.typeId
    ? await resolveNotificationChannels(options.typeId)
    : { enabled: true, whatsapp: true, push: true, telegram: true }

  if (!channels.enabled) {
    return { telegram: false, whatsapp: false, webPush: 0, expoPush: 0, skipped: true }
  }

  await saveChatMessage('assistant', text, source)

  let telegram = false
  let whatsapp = false
  let webPush = 0
  let expoPush = 0

  const title = options?.title ?? deriveTitle(text)
  const body = excerpt(text)
  const url = options?.url ?? '/chat'

  try {
    await createNotification({ title, body, url, type: 'cron' })
  } catch (err) {
    console.warn('[push-notifications] createNotification failed:', err)
  }

  if (channels.push) {
    try {
      webPush = await sendBrowserPush(title, body, url)
    } catch (err) {
      console.warn('[push-notifications] Web push failed:', err)
    }

    try {
      expoPush = await sendExpoPush(title, body, url)
    } catch (err) {
      console.warn('[push-notifications] Expo push failed:', err)
    }
  }

  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  if (channels.telegram && process.env.TELEGRAM_BOT_TOKEN && chatId) {
    await sendTelegramMessage(Number(chatId), text)
    telegram = true
  }

  if (channels.whatsapp && isWhatsAppConfigured()) {
    whatsapp = await sendWhatsAppMessage(text)
  }

  return { telegram, whatsapp, webPush, expoPush }
}
