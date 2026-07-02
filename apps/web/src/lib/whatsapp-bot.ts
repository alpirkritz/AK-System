import { formatAgentList, getAgentDisplayName, HUGO_AGENT_ID } from './abc-agents'
import { runAgentForUser } from './agent-runner'
import { saveChatMessage } from './conversation-engine'
import { getGeminiModelOptions } from './gemini-config'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'
import { sendBrowserPush } from './web-push'
import { sendExpoPush } from './expo-push'
import { createNotification } from './notification-store'
import { chatMessages, getDb, desc, eq } from '@ak-system/database'

function normalizeEchoText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function isEchoContent(inbound: string, outbound: string): boolean {
  const a = normalizeEchoText(outbound)
  const u = normalizeEchoText(inbound)
  if (!a || !u) return false
  if (a === u) return true
  if (a.length >= 40 && u.length >= 40 && a.slice(0, 40) === u.slice(0, 40)) return true
  // WhatsApp may deliver a truncated echo of a longer outbound message.
  if (u.length >= 40 && a.startsWith(u.slice(0, 40))) return true
  if (a.length >= 40 && u.startsWith(a.slice(0, 40))) return true
  return false
}

async function isEchoOfRecentOutbound(userText: string): Promise<boolean> {
  const recentHistory = await getAgentHistory(HUGO_AGENT_ID, 15)
  for (const m of [...recentHistory].reverse()) {
    if (m.role === 'assistant' && isEchoContent(userText, m.content)) return true
  }

  const db = getDb()
  const recentChat = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.role, 'assistant'))
    .orderBy(desc(chatMessages.createdAt))
    .limit(20)
  for (const m of recentChat) {
    if (isEchoContent(userText, m.content)) return true
  }

  return false
}

function pushExcerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max - 1) + '…'
}

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

  // Ignore bot echo — compare against recent assistant output (agent + chat store).
  if (await isEchoOfRecentOutbound(userText)) {
    console.warn('[WhatsAppBot] Ignored echo of recent assistant reply')
    return ''
  }

  console.log(`[WhatsAppBot] Hugo ← "${userText.slice(0, 80)}"`)

  try {
    await saveChatMessage('user', userText, 'whatsapp')

    if (/^\/(?:agents|סוכנים)\s*$/i.test(userText)) {
      const list = formatAgentList()
      await saveChatMessage('assistant', list, 'whatsapp')
      return list
    }

    const recentHistory = await getAgentHistory(HUGO_AGENT_ID, 10)
    const history = recentHistory
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
    // Mirror Hugo's reply to the phone as an OS push (WhatsApp self-chat does not notify reliably).
    try {
      const pushTitle = getAgentDisplayName(HUGO_AGENT_ID)
      const pushBody = pushExcerpt(result.text)
      await createNotification({ title: pushTitle, body: pushBody, url: '/chat', type: 'hugo' })
      await sendBrowserPush(pushTitle, pushBody, '/chat')
      await sendExpoPush(pushTitle, pushBody, '/chat')
    } catch (err) {
      console.warn('[WhatsAppBot] Push failed:', err)
    }
    return result.text
  } catch (err) {
    console.error('[WhatsAppBot] Error:', err)
    const fallback =
      err instanceof Error && err.message.includes("First content should be with role 'user'")
        ? 'שגיאה בהיסטוריית השיחה. נסה שוב.'
        : err instanceof Error && isGeminiNetworkError(err)
          ? 'הבקשה ארכה יותר מדי. נסה שוב או פצל לשתי הודעות קצרות.'
          : 'שגיאה בעיבוד הבקשה. נסה שוב בעוד רגע.'
    await saveChatMessage('assistant', fallback, 'whatsapp').catch(() => {})
    return fallback
  }
}

function isGeminiNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')
}

export async function summarizeFomoMessages(
  groupName: string,
  messages: BufferedGroupMessage[],
): Promise<string | null> {
  if (messages.length === 0) return null

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) return null

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(geminiKey)
  const model = genAI.getGenerativeModel(getGeminiModelOptions())

  const lines = messages.slice(-25).map((m) => {
    const time = new Date(m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp).toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return `[${time}] ${m.senderName}: ${m.text}`
  })

  const prompt = [
    `You are summarizing a burst of WhatsApp activity in group "${groupName}" for a personal FOMO alert.`,
    'Respond in Hebrew unless most messages are in English.',
    'Format exactly like this (no extra headings):',
    'נושא: [one short line — what is being discussed]',
    'תקציר:',
    '• [first key point]',
    '• [second key point if needed]',
    '• [third key point if needed — max 3 bullets]',
    'Keep the whole reply under 280 characters. Do not invent facts not in the messages.',
    '',
    'Messages:',
    lines.join('\n'),
  ].join('\n')

  try {
    const result = await model.generateContent(prompt)
    const summary = result.response.text().trim()
    return summary || null
  } catch (err) {
    console.warn('[summarizeFomoMessages]', err)
    return null
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
  const model = genAI.getGenerativeModel(getGeminiModelOptions())

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
