import { type NextRequest, NextResponse } from 'next/server'
import {
  sendWhatsAppMessage,
  summarizeFomoMessages,
  verifyWhatsAppBridgeAuth,
  type BufferedGroupMessage,
} from '@/lib/whatsapp-bot'
import { saveChatMessage } from '@/lib/conversation-engine'
import { sendBrowserPush } from '@/lib/web-push'
import { sendExpoPush } from '@/lib/expo-push'
import { createNotification } from '@/lib/notification-store'
import { getDb, whatsappGroups } from '@ak-system/database'
import { resolveNotificationChannels } from '@ak-system/api'
import { eq } from 'drizzle-orm'

function fallbackFomoSnippet(messages: BufferedGroupMessage[]): string {
  const recent = messages.slice(-3)
  if (recent.length === 0) return ''
  const lines = recent.map((m) => `• ${m.senderName}: ${m.text.slice(0, 80)}`)
  return `תקציר:\n${lines.join('\n')}`
}

/**
 * POST /api/whatsapp/group-alert — FOMO / keyword alerts from bridge.
 * Delivers short Hebrew message to Message Yourself only.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    type?: 'fomo' | 'keyword'
    groupJid?: string
    groupName?: string
    snippet?: string
    match?: string
    count?: number
    messages?: BufferedGroupMessage[]
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, groupJid, groupName, snippet, messages } = body
  if (!type || !groupJid) {
    return NextResponse.json({ error: 'type and groupJid are required' }, { status: 400 })
  }

  const name = groupName?.trim() || groupJid.split('@')[0] || 'קבוצה'

  let text: string
  if (type === 'fomo') {
    const count = body.count ?? messages?.length ?? 0
    const header = `🔔 FOMO — ${name}\n${count} הודעות בזמן קצר.`
    const context = messages?.length
      ? (await summarizeFomoMessages(name, messages)) ?? fallbackFomoSnippet(messages)
      : (snippet ?? '')
    text = context ? `${header}\n\n${context}`.trim() : header
  } else {
    const match = body.match?.trim() || 'מילת מפתח'
    text = `🔑 מילת מפתח — ${name}\n"${match}"\n${(snippet ?? '').slice(0, 200)}`.trim()
  }

  try {
    await saveChatMessage('assistant', text, 'whatsapp')
    await sendWhatsAppMessage(text)
    try {
      const channels = await resolveNotificationChannels(
        type === 'fomo' ? 'whatsapp_fomo' : 'whatsapp_keyword',
      )
      if (channels.push) {
        const pushTitle = type === 'fomo' ? `🔔 FOMO — ${name}` : `🔑 ${name}`
        const pushBody = text.slice(0, 240)
        await createNotification({
          title: pushTitle,
          body: pushBody,
          url: '/settings/whatsapp',
          type: 'fomo',
        })
        await sendBrowserPush(pushTitle, pushBody, '/settings/whatsapp')
        await sendExpoPush(pushTitle, pushBody, '/settings/whatsapp')
      }
    } catch (pushErr) {
      console.warn('[WhatsApp group-alert] Web push failed:', pushErr)
    }
    if (type === 'fomo') {
      const db = getDb()
      await db
        .update(whatsappGroups)
        .set({ lastFomoAlertAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(whatsappGroups.jid, groupJid))
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[WhatsApp group-alert]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
