import { saveChatMessage } from './conversation-engine'
import { isWhatsAppConfigured, sendWhatsAppMessage } from './whatsapp-bot'
import { sendTelegramMessage } from './telegram-bot'

/**
 * Push an assistant message to configured mobile channels (Telegram + WhatsApp).
 * Always persists to chat_messages with the given source (default: cron).
 */
export async function pushAssistantMessage(
  text: string,
  source: 'cron' | 'whatsapp' = 'cron',
): Promise<{ telegram: boolean; whatsapp: boolean }> {
  await saveChatMessage('assistant', text, source)

  let telegram = false
  let whatsapp = false

  const chatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  if (process.env.TELEGRAM_BOT_TOKEN && chatId) {
    await sendTelegramMessage(Number(chatId), text)
    telegram = true
  }

  if (isWhatsAppConfigured()) {
    whatsapp = await sendWhatsAppMessage(text)
  }

  return { telegram, whatsapp }
}
