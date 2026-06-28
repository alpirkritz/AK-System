import { type NextRequest, NextResponse } from 'next/server'
import {
  getAgentHistory,
  getCursorAgentId,
  saveAgentMessage,
  saveCursorAgentId,
} from '@/lib/agent-chat-store'
import { getAgentEngine } from '@/lib/abc-agents'
import { runAgentChat } from '@/lib/cursor-agent-engine'
import { runGeminiAgentChat } from '@/lib/gemini-agent-engine'

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

    const engine = getAgentEngine()
    let assistantText: string
    let cursorAgentId: string | undefined

    if (engine === 'gemini') {
      const result = await runGeminiAgentChat({ agentId, message, history })
      assistantText = result.text
    } else {
      const cursorId = await getCursorAgentId(agentId)
      const result = await runAgentChat({
        agentId,
        message,
        cursorAgentId: cursorId,
        history,
      })
      assistantText = result.text
      cursorAgentId = result.cursorAgentId
      await saveCursorAgentId(agentId, result.cursorAgentId)
    }

    await saveAgentMessage(agentId, 'assistant', assistantText)

    return NextResponse.json({
      assistantMessage: assistantText,
      engine,
      ...(cursorAgentId ? { cursorAgentId } : {}),
    })
  } catch (err) {
    console.error('[api/agents/chat]', err)
    const msg = err instanceof Error ? err.message : 'Agent chat failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
