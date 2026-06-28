import { type NextRequest, NextResponse } from 'next/server'
import {
  getAgentHistory,
  getCursorAgentId,
  saveAgentMessage,
  saveCursorAgentId,
} from '@/lib/agent-chat-store'
import { runAgentChat } from '@/lib/cursor-agent-engine'

export const maxDuration = 300

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { agentId?: string; message?: string }
    const agentId = body.agentId?.trim()
    const message = body.message?.trim()
    if (!agentId || !message) {
      return NextResponse.json({ error: 'agentId and message are required' }, { status: 400 })
    }

    const history = (await getAgentHistory(agentId, 20))
      .filter((m: { role: string }) => m.role === 'user' || m.role === 'assistant')
      .map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    await saveAgentMessage(agentId, 'user', message)

    const cursorAgentId = await getCursorAgentId(agentId)
    const result = await runAgentChat({
      agentId,
      message,
      cursorAgentId,
      history,
    })

    await saveCursorAgentId(agentId, result.cursorAgentId)
    await saveAgentMessage(agentId, 'assistant', result.text)

    return NextResponse.json({
      assistantMessage: result.text,
      cursorAgentId: result.cursorAgentId,
    })
  } catch (err) {
    console.error('[api/agents/chat]', err)
    const msg = err instanceof Error ? err.message : 'Agent chat failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
