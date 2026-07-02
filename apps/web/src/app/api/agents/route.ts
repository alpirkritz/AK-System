import { NextResponse } from 'next/server'
import { getAgentEngine, listAgents } from '@/lib/abc-agents'

// Reads A_Agents/*.md from disk — must not be statically generated at build time
// (deploy build may set ABC_ROOT=/app which does not exist on the Mac builder).
export const dynamic = 'force-dynamic'

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
