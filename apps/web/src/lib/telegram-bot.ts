import { formatAgentList, parseAgentCommand } from './abc-agents'
import { runAgentForUser } from './agent-runner'
import { resolveIntent, saveChatMessage } from './conversation-engine'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'

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

    const agentCommand = parseAgentCommand(userText)
    if (agentCommand) {
      if (agentCommand.agentId === '__list__') {
        const list = formatAgentList()
        await saveChatMessage('assistant', list, 'telegram')
        await sendTelegramMessage(chatId, list)
        return
      }

      const history = (await getAgentHistory(agentCommand.agentId, 10))
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

      await saveAgentMessage(agentCommand.agentId, 'user', agentCommand.message)
      const result = await runAgentForUser({
        agentId: agentCommand.agentId,
        message: agentCommand.message,
        history,
        channel: 'telegram',
      })
      await saveAgentMessage(agentCommand.agentId, 'assistant', result.text)
      await saveChatMessage('assistant', result.text, 'telegram')
      await sendTelegramMessage(chatId, result.text)
      return
    }

    const response = await resolveIntent(userText, { channel: 'telegram' })
    await saveChatMessage('assistant', response || '', 'telegram')
    await sendTelegramMessage(chatId, response || 'לא הצלחתי לקבל תשובה.')
  } catch (err) {
    console.error('[TelegramBot] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await sendTelegramMessage(chatId, `שגיאה: ${msg}`)
  }
}
