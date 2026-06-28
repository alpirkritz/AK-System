import { NextResponse } from 'next/server'
import { getAgentEngine, listAgents } from '@/lib/abc-agents'

export async function GET(): Promise<NextResponse> {
  try {
    const agents = listAgents()
    return NextResponse.json({ agents, engine: getAgentEngine() })
  } catch (err) {
    console.error('[api/agents]', err)
    const msg = err instanceof Error ? err.message : 'Failed to list agents'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
