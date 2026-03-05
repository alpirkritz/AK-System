import { type NextRequest, NextResponse } from 'next/server'
import { resolveIntent, saveChatMessage } from '@/lib/conversation-engine'

/**
 * POST /api/chat — send a message to the conversation engine.
 * Body: { message: string }
 * Returns: { userMessage, assistantMessage }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { message?: string }
    const message = body.message?.trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    await saveChatMessage('user', message, 'web')

    const response = await resolveIntent(message)
    const assistantText = response || 'לא הצלחתי לקבל תשובה.'

    await saveChatMessage('assistant', assistantText, 'web')

    return NextResponse.json({
      userMessage: message,
      assistantMessage: assistantText,
    })
  } catch (err) {
    console.error('[api/chat]', err)
    const msg = err instanceof Error ? err.message : 'Chat failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
