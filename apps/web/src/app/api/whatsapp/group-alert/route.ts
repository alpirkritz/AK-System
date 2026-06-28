import { type NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppMessage, verifyWhatsAppBridgeAuth } from '@/lib/whatsapp-bot'
import { saveChatMessage } from '@/lib/conversation-engine'
import { db, whatsappGroups } from '@ak-system/database'
import { eq } from 'drizzle-orm'

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
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, groupJid, groupName, snippet } = body
  if (!type || !groupJid) {
    return NextResponse.json({ error: 'type and groupJid are required' }, { status: 400 })
  }

  const name = groupName?.trim() || groupJid.split('@')[0] || 'קבוצה'

  let text: string
  if (type === 'fomo') {
    const count = body.count ?? 0
    text = `🔔 FOMO — ${name}\n${count} הודעות בזמן קצר.\n${snippet ?? ''}`.trim()
  } else {
    const match = body.match?.trim() || 'מילת מפתח'
    text = `🔑 מילת מפתח — ${name}\n"${match}"\n${(snippet ?? '').slice(0, 200)}`.trim()
  }

  try {
    await saveChatMessage('assistant', text, 'whatsapp')
    await sendWhatsAppMessage(text)
    if (type === 'fomo') {
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
