import { type NextRequest, NextResponse } from 'next/server'
import { saveChatMessage } from '@/lib/conversation-engine'
import { runHugoConversation } from '@/lib/agent-runner'
import { clientChannel, getApiSession } from '@/lib/api-session'

/**
 * POST /api/chat — send a message to Hugo.
 * Body: { message: string }
 * Returns: { userMessage, assistantMessage }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as { message?: string }
    const message = body.message?.trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const channel = clientChannel(request)
    await saveChatMessage('user', message, channel)

    // The caller renders the reply, so no push — see runHugoConversation.
    const response = await runHugoConversation({ message, channel, notifyOnComplete: false })
    const assistantText = response.text || 'לא הצלחתי לקבל תשובה.'

    await saveChatMessage('assistant', assistantText, channel)

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
