import { resolveIntent, saveChatMessage } from './conversation-engine'

// ─── Telegram types ───────────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  from?: { id: number; first_name: string; username?: string }
  chat: { id: number; type: string }
  date: number
  text?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  if (!allowedChatId) throw new Error('TELEGRAM_ALLOWED_CHAT_ID is not set')
  return { token, allowedChatId: Number(allowedChatId) }
}

// ─── Telegram API ─────────────────────────────────────────────────────────────

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const { token } = getConfig()
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[TelegramBot] sendMessage failed:', body)
  }
}

// ─── Main update handler ──────────────────────────────────────────────────────

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const { allowedChatId } = getConfig()
  const message = update.message
  if (!message?.text) return

  const chatId = message.chat.id
  if (chatId !== allowedChatId) {
    console.warn(`[TelegramBot] Rejected message from unauthorized chat ID: ${chatId}`)
    return
  }

  const userText = message.text.trim()
  console.log(`[TelegramBot] Received: "${userText}"`)

  try {
    await saveChatMessage('user', userText, 'telegram')
    const response = await resolveIntent(userText)
    await saveChatMessage('assistant', response || '', 'telegram')
    await sendTelegramMessage(chatId, response || 'לא הצלחתי לקבל תשובה.')
  } catch (err) {
    console.error('[TelegramBot] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await sendTelegramMessage(chatId, `שגיאה: ${msg}`)
  }
}
