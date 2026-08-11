import { type NextRequest, NextResponse } from 'next/server'
import { getAgentHistory } from '@/lib/agent-chat-store'
import { getApiSession } from '@/lib/api-session'

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const agentId = request.nextUrl.searchParams.get('agentId')
    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }
    const messages = await getAgentHistory(agentId)
    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[api/agents/history]', err)
    const msg = err instanceof Error ? err.message : 'Failed to load history'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
