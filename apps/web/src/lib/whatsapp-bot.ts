import { formatAgentList, HUGO_AGENT_ID } from './abc-agents'
import { runAgentForUser } from './agent-runner'
import { saveChatMessage } from './conversation-engine'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'

export type ChatSource = 'web' | 'telegram' | 'whatsapp' | 'cron'

export interface WhatsAppInboundPayload {
  message: string
  from: string
  chatJid: string
  messageId?: string
}

export interface BufferedGroupMessage {
  id: string
  sender: string
  senderName: string
  text: string
  timestamp: number
}

function getBridgeConfig() {
  const url = process.env.WHATSAPP_BRIDGE_URL
  const secret = process.env.WHATSAPP_BRIDGE_SECRET
  return { url, secret, configured: !!(url && secret) }
}

function normalizeJid(jid: string): string {
  return jid.split(':')[0] ?? jid
}

function isAllowedInbound(jid: string): boolean {
  const allowed = process.env.WHATSAPP_ALLOWED_JID
  const allowedLid = process.env.WHATSAPP_ALLOWED_LID
  if (!allowed && !allowedLid) return false
  const normalized = normalizeJid(jid)
  if (allowed && normalized === normalizeJid(allowed)) return true
  if (allowedLid && normalized === normalizeJid(allowedLid)) return true
  return false
}

function getSelfChatTarget(): string | undefined {
  return process.env.WHATSAPP_ALLOWED_LID || process.env.WHATSAPP_ALLOWED_JID
}

export function isWhatsAppConfigured(): boolean {
  return getBridgeConfig().configured
}

export async function sendWhatsAppMessage(text: string, to?: string): Promise<boolean> {
  const { url, secret, configured } = getBridgeConfig()
  if (!configured) return false

  const target = to || getSelfChatTarget()
  if (!target) {
    console.error('[WhatsAppBot] No self-chat target configured')
    return false
  }
  if (to && !isAllowedInbound(to)) {
    console.error('[WhatsAppBot] Blocked send to non-self JID:', to)
    return false
  }

  const res = await fetch(`${url!.replace(/\/$/, '')}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ text: text.slice(0, 65000), to: target }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[WhatsAppBot] send failed:', body)
    return false
  }
  return true
}

export async function handleWhatsAppInbound(payload: WhatsAppInboundPayload): Promise<string> {
  if (!isAllowedInbound(payload.from) || !isAllowedInbound(payload.chatJid)) {
    console.warn(`[WhatsAppBot] Rejected non-self-chat JID: from=${payload.from} chat=${payload.chatJid}`)
    return ''
  }

  const userText = payload.message.trim()
  if (!userText) return ''

  console.log(`[WhatsAppBot] Hugo ← "${userText.slice(0, 80)}"`)

  try {
    await saveChatMessage('user', userText, 'whatsapp')

    if (/^\/(?:agents|סוכנים)\s*$/i.test(userText)) {
      const list = formatAgentList()
      await saveChatMessage('assistant', list, 'whatsapp')
      return list
    }

    const history = (await getAgentHistory(HUGO_AGENT_ID, 10))
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    await saveAgentMessage(HUGO_AGENT_ID, 'user', userText)
    const result = await runAgentForUser({
      agentId: HUGO_AGENT_ID,
      message: userText,
      history,
      channel: 'whatsapp',
    })
    await saveAgentMessage(HUGO_AGENT_ID, 'assistant', result.text)
    await saveChatMessage('assistant', result.text, 'whatsapp')
    return result.text
  } catch (err) {
    console.error('[WhatsAppBot] Error:', err)
    return ''
  }
}

export async function summarizeGroupMessages(
  groupJid: string,
  messages: BufferedGroupMessage[],
): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' })

  const lines = messages.map((m) => {
    const time = new Date(m.timestamp).toLocaleString('he-IL')
    return `[${time}] ${m.senderName}: ${m.text}`
  })

  const prompt = [
    'Summarize the following WhatsApp group conversation for personal triage.',
    `Group: ${groupJid}`,
    'Respond in Hebrew unless most messages are in English.',
    'Be concise: key topics, decisions, action items, questions needing reply.',
    'Do not invent facts not present in the messages.',
    '',
    'Messages:',
    lines.join('\n'),
  ].join('\n')

  const result = await model.generateContent(prompt)
  const summary = result.response.text().trim()
  if (!summary) throw new Error('Empty summary from Gemini')

  const header = `📋 סיכום קבוצה\n${groupJid.split('@')[0]}\n\n`
  const full = (header + summary).slice(0, 65000)
  await saveChatMessage('assistant', full, 'whatsapp')
  return full
}

export function verifyWhatsAppBridgeAuth(request: Request): boolean {
  const secret = process.env.WHATSAPP_BRIDGE_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  const token = auth?.replace(/^Bearer\s+/i, '')
  return token === secret
}
