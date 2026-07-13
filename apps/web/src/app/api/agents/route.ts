import { NextResponse } from 'next/server'
import { listAgentsWithDisplayNames } from '@ak-system/api'
import { getAgentEngine } from '@/lib/abc-agents'

// Reads A_Agents/*.md from disk — must not be statically generated at build time
// (deploy build may set ABC_ROOT=/app which does not exist on the Mac builder).
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const agents = await listAgentsWithDisplayNames()
    return NextResponse.json({ agents, engine: getAgentEngine() })
  } catch (err) {
    console.error('[api/agents]', err)
    const msg = err instanceof Error ? err.message : 'Failed to list agents'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
