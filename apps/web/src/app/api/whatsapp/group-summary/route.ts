import { type NextRequest, NextResponse } from 'next/server'
import {
  summarizeGroupMessages,
  verifyWhatsAppBridgeAuth,
  type BufferedGroupMessage,
} from '@/lib/whatsapp-bot'
import { sendBrowserPush } from '@/lib/web-push'
import { sendExpoPush } from '@/lib/expo-push'
import { createNotification } from '@/lib/notification-store'

/**
 * POST /api/whatsapp/group-summary — Gemini summary of buffered group messages.
 * Called by whatsapp-bridge POST /groups/summarize.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyWhatsAppBridgeAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { groupJid?: string; messages?: BufferedGroupMessage[] }
  try {
    body = (await request.json()) as { groupJid?: string; messages?: BufferedGroupMessage[] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const groupJid = body.groupJid?.trim()
  const messages = body.messages
  if (!groupJid || !messages?.length) {
    return NextResponse.json({ error: 'groupJid and messages are required' }, { status: 400 })
  }

  try {
    const summary = await summarizeGroupMessages(groupJid, messages)
    try {
      const name = groupJid.split('@')[0] || 'קבוצה'
      const pushTitle = `📋 סיכום קבוצה — ${name}`
      const pushBody = summary.slice(0, 240)
      await createNotification({
        title: pushTitle,
        body: pushBody,
        url: '/settings/whatsapp',
        type: 'fomo',
      })
      await sendBrowserPush(pushTitle, pushBody, '/settings/whatsapp')
      await sendExpoPush(pushTitle, pushBody, '/settings/whatsapp')
    } catch (pushErr) {
      console.warn('[WhatsApp group-summary] Web push failed:', pushErr)
    }
    return NextResponse.json({ summary, reply: summary })
  } catch (err) {
    console.error('[WhatsApp group-summary]', err)
    const msg = err instanceof Error ? err.message : 'Summary failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
