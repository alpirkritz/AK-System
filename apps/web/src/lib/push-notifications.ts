import { saveChatMessage } from './conversation-engine'
import { isWhatsAppConfigured, sendWhatsAppMessage } from './whatsapp-bot'
import { sendTelegramMessage } from './telegram-bot'
import { sendBrowserPush } from './web-push'
import { sendMobilePush } from './mobile-push'
import { createNotification } from './notification-store'
import { withChatMessageId } from './notification-url'
import { resolveNotificationChannels } from '@ak-system/api'

/** Short, single-line form for the OS push payload only — never for the stored body. */
function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

/** Derive a short notification title from the first line of the message. */
function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'ARO'
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
): Promise<{ telegram: boolean; whatsapp: boolean; webPush: number; fcmPush: number; skipped?: boolean }> {
  const channels = options?.typeId
    ? await resolveNotificationChannels(options.typeId)
    : { enabled: true, whatsapp: true, push: true, telegram: true }

  if (!channels.enabled) {
    return { telegram: false, whatsapp: false, webPush: 0, fcmPush: 0, skipped: true }
  }

  const messageId = await saveChatMessage('assistant', text, source)

  let telegram = false
  let whatsapp = false
  let webPush = 0
  let fcmPush = 0

  const title = options?.title ?? deriveTitle(text)
  const pushBody = excerpt(text)
  const url = withChatMessageId(options?.url ?? '/chat', messageId)

  try {
    await createNotification({ title, body: text, url, type: 'cron' })
  } catch (err) {
    console.warn('[push-notifications] createNotification failed:', err)
  }

  if (channels.push) {
    try {
      webPush = await sendBrowserPush(title, pushBody, url)
    } catch (err) {
      console.warn('[push-notifications] Web push failed:', err)
    }

    try {
      fcmPush = await sendMobilePush(title, pushBody, url)
    } catch (err) {
      console.warn('[push-notifications] FCM push failed:', err)
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

  return { telegram, whatsapp, webPush, fcmPush }
}
